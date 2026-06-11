# Multi-Account Role & Organization System — Implementation Plan

> [!IMPORTANT]
> **This plan is historical.** The agency feature described below was
> implemented in full (phases BP1–BP7 + linear steps 1–3). For the
> **current** data model, APIs, routing engine, and known gaps, see
> [`docs/AGENCY_SPEC.md`](docs/AGENCY_SPEC.md). This file is kept
> as a record of the original plan — any discrepancy between PLAN.md
> and AGENCY_SPEC.md, AGENCY_SPEC.md wins.

## Summary

Add three account levels to Koala:
1. **Provider** — default for every user, current solo workflow stays intact
2. **Agency** — self-serve agency creation, invite providers, oversight dashboard at `/agency`
3. **Platform Admin** — existing `/admin` extended with agency/agency/invitation management

---

## Architecture

### Domain Model

| Table | Purpose |
|---|---|
| `User` | Add `platform_role` (user \| admin). Existing Clerk metadata stays as middleware fast-path. |
| `Agency` | Agency entity. One owner per agency. One agency per owner (enforced by DB). |
| `AgencyMembership` | Join table: user ↔ agency with role (agency_owner \| agency_admin \| provider_member). |
| `Space` | Add nullable `agencyId` FK. Provider workspace stays the atomic unit. |
| `Invitation` | Token-based invite. Pending until accepted or expired. |

### Roles

- **platform_role** on User: `user` (default) or `admin`
- **AgencyMembership.role**: `agency_owner`, `agency_admin`, `provider_member`
- "Is an agency" = has any AgencyMembership where role ∈ {agency_owner, agency_admin}

### Permissions (central helpers in `lib/permissions.ts`)

```
isPlatformAdmin(clerkUserId) → boolean    — checks DB platform_role (Clerk metadata fallback)
requirePlatformAdmin()       → { userId } — throws if not admin
getAgencyForUser(userId)  → Agency | null
requireAgency()              → { agency, membership } — throws if not agency
```

### Routing

| Route | Auth |
|---|---|
| `/agency` | requireAgency() |
| `/agency/members` | requireAgency() |
| `/agency/invitations` | requireAgency() |
| `/invite/[token]` | Clerk auth required (sign in if not) |
| `/admin/agencies` | requirePlatformAdmin() |
| `/admin/invitations` | requirePlatformAdmin() |

---

## Phase 1 — Database Migration

### Migration file: `supabase/migrations/20260314000003_org_system.sql`

```sql
-- 1. platform_role on User
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "platformRole" text NOT NULL DEFAULT 'user'
  CHECK ("platformRole" IN ('user', 'admin'));

-- 2. Agency table
CREATE TABLE IF NOT EXISTS "Agency" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        text NOT NULL,
  "ownerId"   text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  "websiteUrl" text,
  "logoUrl"   text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_owner ON "Agency"("ownerId");
CREATE INDEX IF NOT EXISTS idx_agency_status ON "Agency"(status);

-- 3. AgencyMembership table
CREATE TABLE IF NOT EXISTS "AgencyMembership" (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "agencyId"  text NOT NULL REFERENCES "Agency"(id) ON DELETE CASCADE,
  "userId"       text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  role           text NOT NULL CHECK (role IN ('agency_owner', 'agency_admin', 'provider_member')),
  "invitedById"  text REFERENCES "User"(id) ON DELETE SET NULL,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("agencyId", "userId")
);
CREATE INDEX IF NOT EXISTS idx_membership_agency ON "AgencyMembership"("agencyId");
CREATE INDEX IF NOT EXISTS idx_membership_user ON "AgencyMembership"("userId");

-- 4. Add agencyId to Space (nullable — existing spaces unaffected)
ALTER TABLE "Space"
  ADD COLUMN IF NOT EXISTS "agencyId" text REFERENCES "Agency"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_space_agency ON "Space"("agencyId");

-- 5. Invitation table
CREATE TABLE IF NOT EXISTS "Invitation" (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "agencyId"  text NOT NULL REFERENCES "Agency"(id) ON DELETE CASCADE,
  email          text NOT NULL,
  "roleToAssign" text NOT NULL CHECK ("roleToAssign" IN ('agency_admin', 'provider_member')),
  token          text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  "expiresAt"    timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  "invitedById"  text REFERENCES "User"(id) ON DELETE SET NULL,
  "createdAt"    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitation_agency ON "Invitation"("agencyId");
CREATE INDEX IF NOT EXISTS idx_invitation_email ON "Invitation"(email);
CREATE INDEX IF NOT EXISTS idx_invitation_token ON "Invitation"(token);
CREATE INDEX IF NOT EXISTS idx_invitation_status ON "Invitation"(status);

-- 6. RLS for new tables (service role bypasses; these are defense-in-depth)
ALTER TABLE "Agency"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgencyMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation"          ENABLE ROW LEVEL SECURITY;
```

### Schema.sql update
Add the same tables to `supabase/schema.sql` (source of truth for fresh installs).

---

## Phase 2 — Types & Permission Helpers

### `lib/types.ts` additions
```ts
export type PlatformRole = 'user' | 'admin';
export type MembershipRole = 'agency_owner' | 'agency_admin' | 'provider_member';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';

export type Agency = {
  id: string; name: string; ownerId: string;
  status: 'active' | 'suspended'; websiteUrl: string | null;
  logoUrl: string | null; createdAt: Date;
};

export type AgencyMembership = {
  id: string; agencyId: string; userId: string;
  role: MembershipRole; invitedById: string | null; createdAt: Date;
};

export type Invitation = {
  id: string; agencyId: string; email: string;
  roleToAssign: Omit<MembershipRole, 'agency_owner'>;
  token: string; status: InvitationStatus;
  expiresAt: Date; invitedById: string | null; createdAt: Date;
};
```

### `lib/permissions.ts` (new file)
```ts
// Central permission helpers — use these everywhere, never raw role checks.
isPlatformAdmin(clerkUserId)   → Promise<boolean>
requirePlatformAdmin()         → Promise<{ userId: string }>
getAgencyForUser(dbUserId)  → Promise<{ agency, membership } | null>
requireAgency()                → Promise<{ agency, membership, dbUserId }>
```

`isPlatformAdmin` checks `User.platformRole = 'admin'` in DB. Also checks Clerk metadata as fallback (backward compatible with any existing admins set via Clerk Dashboard).

### `lib/admin.ts` update
`requireAdmin()` delegates to `requirePlatformAdmin()` from `lib/permissions.ts`.

---

## Phase 3 — Middleware

`middleware.ts`: add `/agency` to protected route matchers so unauthenticated users get redirected to sign-in. Admin check in middleware stays as Clerk metadata (edge-compatible, no DB).

---

## Phase 4 — API Routes

### `POST /api/agency/create`
- Auth: any signed-in user with a completed workspace
- Creates Agency row + AgencyMembership (role: agency_owner)
- Enforces one agency per owner (409 if exists)

### `POST /api/agency/invite`
- Auth: requireAgency()
- Body: `{ email, role }` (role: provider_member | agency_admin)
- Creates Invitation row
- Sends email via Resend with `/invite/[token]` link
- Idempotent: if pending invite for same email exists, return existing (don't send duplicate)

### `GET /api/agency/stats`
- Auth: requireAgency()
- Returns member counts, total leads, total applications across all member spaces

### `GET /api/invitations/[token]`
- Public read — returns agency name + invitation details for the accept page
- Does NOT expose sensitive data

### `POST /api/invitations/[token]/accept`
- Auth: signed-in user
- Validates token (pending, not expired)
- Creates AgencyMembership for the current user
- Links their Space.agencyId
- Marks invitation accepted
- If user already a member: no-op (idempotent)

### `GET /api/admin/agencies`
- Auth: requirePlatformAdmin()
- Returns all Agency rows with owner info and member counts

### `GET /api/admin/invitations`
- Auth: requirePlatformAdmin()
- Returns all Invitation rows

### `PATCH /api/admin/agencies/[id]`
- Auth: requirePlatformAdmin()
- Body: `{ status: 'active' | 'suspended' }`
- Suspends or reactivates an agency

### `DELETE /api/admin/memberships/[id]`
- Auth: requirePlatformAdmin()
- Removes an AgencyMembership (and unlinks Space.agencyId)

---

## Phase 5 — Agency Dashboard

### `app/agency/layout.tsx`
- Server component: calls requireAgency(), passes agency to children
- Renders `AgencyShell` (sidebar + header matching existing admin shell style)
- Mobile responsive (same pattern as AdminShell)

### `app/agency/page.tsx` — Overview
Stats cards: Members, Pending invitations, Total leads across members, Total applications
Recent member list with activation status

### `app/agency/members/page.tsx`
Table of agency members:
- Name, email, role badge, onboarding status badge, workspace slug, date joined

### `app/agency/invitations/page.tsx`
- Pending invitations table (email, role, sent date, expiry, status badge)
- Inline "Invite" form: email + role selector + Send button

### `components/agency/agency-shell.tsx`
Nav items: Overview, Members, Invitations
Back link to provider workspace
Same visual pattern as AdminShell

---

## Phase 6 — Invitation Accept Flow

### `app/invite/[token]/page.tsx`
- Public page (but redirects to sign-in if not authenticated)
- Shows: agency name, inviting agency, role being assigned
- If authenticated: "Accept invitation" button
- If not authenticated: "Sign in to accept" → Clerk sign-in with redirect back to this page
- Error states: expired, already accepted, invalid token

---

## Phase 7 — Admin Dashboard Extension

### `app/admin/agencies/page.tsx`
Cards showing each agency: name, owner, member count, status badge, suspend/reactivate toggle

### `app/admin/invitations/page.tsx`
Full invitations table: agency, email, role, status, expiry, invited by

### `app/admin/users/[id]/page.tsx` (extend existing)
Add agency membership section: show which agency (if any) the user belongs to, role, option to remove membership

### `app/admin/components/admin-shell.tsx` (extend)
Add nav items: Agencies (Building2 icon), Invitations (Mail icon)

---

## Phase 8 — Navigation Updates

### `app/s/[slug]/layout.tsx` (extend)
Fetch agency membership for current user. If agency_owner or agency_admin, pass `isAgency: true` to Sidebar.

### `components/dashboard/sidebar.tsx` (extend)
If `isAgency`, add "Agency" nav link (Building2 icon → `/agency`) in secondary nav section.

### `components/dashboard/mobile-nav.tsx` (extend)
If `isAgency`, add Agency to mobile bottom bar.

---

## Phase 9 — Email Template

### `lib/email.ts`
Add `sendAgencyInvitation({ to, agencyName, inviterName, role, token })` function.
Matches existing email style (plain HTML, same escape helpers, Resend via existing env var).

---

## Architecture Note (ARCHITECTURE.md)
Create short doc in repo root explaining:
- Roles and how they're determined
- Organization model (Agency → Memberships → Spaces)
- Permission rules
- Invitation lifecycle

---

## Migration Safety

- `User.platformRole` defaults to `'user'` — all existing users unaffected
- `Space.agencyId` is nullable — all existing spaces unaffected
- No existing tables dropped or renamed
- requireAdmin() backward compatible (checks both DB platformRole AND Clerk metadata)
- Public intake routes untouched
- Onboarding flow untouched

---

## File Change List

| File | Action |
|---|---|
| `supabase/schema.sql` | Add 3 new tables + Space.agencyId + User.platformRole |
| `supabase/migrations/20260314000003_org_system.sql` | New migration |
| `lib/types.ts` | Add Agency, AgencyMembership, Invitation types |
| `lib/permissions.ts` | New: central permission helpers |
| `lib/admin.ts` | Update requireAdmin to delegate to permissions.ts |
| `lib/email.ts` | Add sendAgencyInvitation() |
| `middleware.ts` | Add /agency to protected routes |
| `app/agency/layout.tsx` | New: agency layout |
| `app/agency/page.tsx` | New: agency overview |
| `app/agency/members/page.tsx` | New: members list |
| `app/agency/invitations/page.tsx` | New: invitations + invite form |
| `components/agency/agency-shell.tsx` | New: agency sidebar shell |
| `app/invite/[token]/page.tsx` | New: accept invitation page |
| `app/api/agency/create/route.ts` | New |
| `app/api/agency/invite/route.ts` | New |
| `app/api/agency/stats/route.ts` | New |
| `app/api/invitations/[token]/route.ts` | New |
| `app/api/admin/agencies/route.ts` | New |
| `app/api/admin/agencies/[id]/route.ts` | New |
| `app/api/admin/invitations/route.ts` | New |
| `app/api/admin/memberships/[id]/route.ts` | New |
| `app/admin/agencies/page.tsx` | New |
| `app/admin/invitations/page.tsx` | New |
| `app/admin/users/[id]/page.tsx` | Extend |
| `app/admin/components/admin-shell.tsx` | Extend nav items |
| `app/s/[slug]/layout.tsx` | Fetch agency status, pass to Sidebar |
| `components/dashboard/sidebar.tsx` | Add Agency link if agency |
| `components/dashboard/mobile-nav.tsx` | Add Agency if agency |
| `ARCHITECTURE.md` | New: role/org/permission docs |
