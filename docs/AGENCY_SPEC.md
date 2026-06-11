# Agency Tier

> The multi-agent layer on top of the provider CRM: organisations ("agencies")
> that own a roster of provider workspaces, route inbound leads, run commission
> ledgers, manage seat-based billing, and surface a compliance-grade activity
> log. This doc is the canonical reference for engineers touching anything
> under `/app/agency/*`, `/app/api/agency/*`, or the agency-scoped
> migrations.

A agency owner signs up; creates their Agency; invites providers; each
provider gets a workspace ("Space") linked back to the agency. Leads route
in via public application forms or manual agency-side entry and land in the
right agent's workspace. Deals close, commissions land in a persistent
ledger. The agency gets visibility across every agent without stepping into
their individual Space.

**Table of contents**

1. Concepts
2. Permission model
3. Data model

_Chunks covering the feature map (BP1–BP7 + the three linear step features),
the route inventory, audit logging, and known gaps are appended by
subsequent writers in separate commits. Search the file for `# Feature map`,
`# Route inventory`, etc._

## 1. Concepts

- **Agency** — top-level organisation. Owned by a single `User` via
  `Agency.ownerId` (FK `ON DELETE RESTRICT`, supabase/schema.sql:34). Has
  a `status` of `active | suspended` (schema.sql:35) and an optional unique
  `joinCode` (schema.sql:38).
- **AgencyMembership** — user ↔ agency join row carrying a `role`
  (schema.sql:239). Unique `(agencyId, userId)` so a given user holds at
  most one role per agency (schema.sql:246).
- **Space** — the per-agent workspace. Linked back to a agency via the
  nullable `Space.agencyId` column (schema.sql:54), `ON DELETE SET NULL`
  so un-agencying never cascades.
- **Invitation** — token-based invite row with a 7-day default TTL
  (schema.sql:257). Status CHECK enum is
  `pending | accepted | expired | cancelled` (schema.sql:255-256).
- **Public entry paths**:
  - `/apply/b/[agencyId]` — inbound lead application form.
  - `/s/[slug]` — a provider's workspace (agent-facing).
  - `/agency/*` — agency-owner/admin control surface.

## 2. Permission model

Three nested helpers, each building on `requireAuth`'s offboarding gate
(`User.status !== 'offboarded'` at lib/api-auth.ts:30-56).

| Helper | Returns | Roles allowed | When to use |
|---|---|---|---|
| `requireAuth` | `{ userId }` or `NextResponse` (401/403) | Any signed-in, non-offboarded user | Default API auth |
| `getAgencyContext` | `{agency, membership, dbUserId}` or `null` | `agency_owner`, `agency_admin` | Server components; page-level gates |
| `requireAgency` | same, throws on null | same | API routes that 403 on missing agency ctx |
| `getAgencyMemberContext` | same | `agency_owner`, `agency_admin`, `provider_member` | Pages/routes that should be visible to any agency member |

**Offboarding hard-stop.** Every agency helper re-checks `User.status` after
Clerk auth and returns `null` if the user has been offboarded (hardening
applied in Phase BP3 audit follow-up, commit 6d05915; see
lib/permissions.ts:72-79 and :131-132). Server-side pages under
`/app/s/[slug]/reviews/*` also re-check this locally (Linear Step 1 audit
follow-up, 4e3fc5e) because they use `auth()` directly instead of going
through `requireAuth`.

**Dual-auth pattern.** `POST /api/agency/reviews/[id]/comments` accepts
EITHER a agency member OR the requesting agent (`review.requestingUserId
=== dbUser.id`). That's the path that lets the provider post comments on
their own flagged-for-review deal.

**Role enum** (lib/permissions.ts, via CHECK at schema.sql:243):
`agency_owner`, `agency_admin`, `provider_member`. The
`Invitation.roleToAssign` column only accepts `agency_admin | provider_member`
(CHECK constraint, schema.sql:253; a new owner is minted by the
create-agency path, not by an invitation).

## 3. Data model

One compact paragraph per table. Cite the migration or schema.sql line
where the table is defined. **Do not dump every column** — name the
important ones and the constraints that matter for correctness, and link
out.

### Agency
The top-level org. Base columns come from
`supabase/migrations/20260314000003_org_system.sql` and are mirrored in
supabase/schema.sql:31-45: `name`, `ownerId` with `ON DELETE RESTRICT`,
`status` enum `active|suspended`, optional `logoUrl`/`websiteUrl`,
`joinCode` (UNIQUE). Billing + routing + commissions add:
- `plan` (`starter|team|enterprise`), `seatLimit`
- `stripeCustomerId`, `stripeSubscriptionId`, `stripeSubscriptionStatus`,
  `stripePeriodEnd`
- `autoAssignEnabled`, `assignmentMethod` (`manual|round_robin|score_based`),
  `lastAssignedUserId` (round-robin cursor)
- `defaultAgentRate`, `defaultAgencyRate` (commission defaults snapshotted
  onto ledger rows at close time)

Added across migrations `20260507000000_commission_ledger.sql` (rate
defaults), `20260509000000_agency_billing.sql`
(plan/seatLimit/stripe*), and `20260513000000_agency_routing.sql`
(autoAssign/method/cursor). See the feature-map chunk for which phase
added which column.

### AgencyMembership
User ↔ Agency join with a `role` enum (schema.sql:239-247). Unique on
`(agencyId, userId)` so a user can only join a given agency once
(schema.sql:246).

### Invitation
Token-based invite (see columns + indexes in
`supabase/migrations/20260314000003_org_system.sql`; mirrored at
schema.sql:249-260). Token is 64-char hex via
`encode(gen_random_bytes(32), 'hex')` (schema.sql:254); 7-day default
`expiresAt` (schema.sql:257). Status enum:
`pending | accepted | expired | cancelled` (schema.sql:255-256).

### Space
The per-agent workspace. Gains a nullable `agencyId` column (same
migration; schema.sql:54) linking it back to the agency; `ON DELETE SET
NULL` so un-agencying a Space doesn't cascade-delete the agent's data.

### Contact
Gains a nullable `agencyId` column in
`supabase/migrations/20260402000001_contact_agency_id.sql` (mirrored
at schema.sql:134) — distinguishes agency-owned leads (routed,
reportable) from an agent's personal contacts. FK is
`ON DELETE SET NULL`.

### CommissionLedger
One row per `won` Deal. Sync trigger on Deal (migration
`supabase/migrations/20260507000000_commission_ledger.sql`). Rates are
snapshotted at close — `defaultAgentRate` / `defaultAgencyRate` from the
Agency at the moment of close. Status CHECK enum:
`pending | paid | void` (migration line 71). `UNIQUE (dealId)` +
`ON CONFLICT DO NOTHING` makes the won-trigger idempotent across
status bounces. Rate-sum cap (≤ 100%) and referral invariant
(non-zero `referralRate` ⇒ non-null `referralUserId`) are enforced at
the API layer, not the schema.

### DealReviewRequest + DealReviewComment
Agency sign-off queue on a specific deal. Migration
`supabase/migrations/20260510000000_deal_review_requests.sql`. Partial
unique index `idx_dealreview_open_per_deal ON "DealReviewRequest"("dealId")
WHERE status = 'open'` (migration lines 92-93) enforces one active
review per deal — API callers must translate a 23505 unique-violation
into a 409. Status CHECK enum: `open | approved | closed` (migration
lines 26-27). `DealReviewComment` references `DealReviewRequest.id`
via `reviewRequestId` with `ON DELETE CASCADE`.

### AgencyTemplate + MessageTemplate.sourceTemplateId / sourceVersion
Versioned playbook library. Migration
`supabase/migrations/20260511000000_agency_templates.sql` replaces a
legacy "magic Note" JSON hack (a Note row with
`title = '[AGENCY_TEMPLATES]'` in the agency_owner's personal Space).
That migration also adds two provenance columns to MessageTemplate
(per-agent copies): `sourceTemplateId` (FK to `AgencyTemplate`,
`ON DELETE SET NULL`) and `sourceVersion` (integer, nullable). The
publish flow uses `sourceVersion IS NULL` as the signal that the agent
edited the copy locally and skips those rows on re-publish. Migration
`20260512000000_template_published_version.sql` adds `publishedVersion`
on AgencyTemplate so the UI can compare `version === publishedVersion`
directly (replaces a flaky `updatedAt` vs `publishedAt` 1-second-slack
heuristic).

### DealRoutingRule
Optional rules-first routing layer. Migration
`supabase/migrations/20260514000000_deal_routing_rules.sql` + hardening
in `supabase/migrations/20260515000000_routing_rules_hardening.sql`.
Criteria fields (`leadType`, `minBudget`, `maxBudget`, `matchTag`) are
all nullable and AND-combined. Destination is XOR-enforced via CHECK
`deal_routing_rule_destination_xor`:
`("destinationUserId" IS NOT NULL AND "destinationPoolMethod" IS NULL) OR ("destinationUserId" IS NULL AND "destinationPoolMethod" IS NOT NULL)`
(migration lines 72-76). A second CHECK
`deal_routing_rule_budget_range` requires `maxBudget >= minBudget` when
both are set. Hardening flipped `destinationUserId` FK from
`ON DELETE SET NULL` to `ON DELETE CASCADE` because the SET NULL +
XOR combination would make a user hard-delete roll back on the CHECK
(20260515 header).

### AuditLog
Single immutable audit table (supabase/schema.sql:284-294). Columns: `id`,
`clerkId` (nullable for system events), `ipAddress`, `action`, `resource`,
`resourceId`, `spaceId` (nullable for agency-wide events), `metadata`
(jsonb — MUST include `agencyId` for null-spaceId events, per the
Linear Step 2 scoping rule), `createdAt`. The `AuditAction` union in
lib/audit.ts:25-36 currently enumerates `CREATE | UPDATE | DELETE |
ACCESS | LOGIN | LOGOUT | ADMIN_ACTION | OFFBOARD`.

## 4. Feature map

Each phase below links to the canonical source. Descriptions name the
key invariant the code protects — that's what you'll break if you
refactor without reading.

### BP1 — Agent offboarding
The `offboard_agency_member(p_leaving_user_id, p_destination_user_id,
p_agency_id, p_dry_run)` RPC in
`supabase/migrations/20260506000000_agency_offboarding.sql` moves
every agency-scoped row owned by the leaving member to the
destination member's Space in a single SECURITY DEFINER transaction —
`Contact` (filtered by `agencyId` + source `spaceId`), the matching
`ContactActivity`, the `Deal` rows linked to those contacts via
`DealContact`, their `DealActivity` + `DealChecklistItem`, and `Appointment`
rows scoped to the moved contacts. The hardening migration
`20260508000000_offboarding_hardening.sql` revoked `authenticated`'s
EXECUTE grant (service_role only now), added a destination-`status =
'active'` check inside the function, and — most importantly — made the
`User.status = 'offboarded'` flip conditional: it only fires when this
was the LAST `AgencyMembership` row. Dual-agency providers leaving
one firm keep their account active (20260508 lines 156-176); only
`offboardedAt` / `offboardedToUserId` are recorded. API:
`POST /api/agency/members/[id]/offboard`. UI:
`components/agency/offboard-member-dialog.tsx`.

### BP2 — Commission ledger
Persistent ledger driven by `sync_commission_ledger()` triggers on
`Deal` (AFTER INSERT and AFTER UPDATE OF status, both gated by
`NEW.status = 'won'` — see `20260507000000_commission_ledger.sql`
lines 181-192). Rates are snapshotted at close time —
`defaultAgentRate` / `defaultAgencyRate` from the Agency row at that
moment — so future rate edits never mutate historical ledger amounts
(migration header, "Snapshot semantics"). `UNIQUE (dealId)` +
`ON CONFLICT DO NOTHING` makes status bounces (won→active→won)
idempotent — re-entering `won` is a no-op after the first transition.
`PATCH /api/agency/commissions/ledger/[id]` validates the rate-sum cap
and rejects a non-zero `referralRate` with a null `referralUserId`
(schema-wise these are unconstrained; enforcement lives at the API).
`GET /api/agency/commissions/export` returns CSV, gated to
`agency_owner` / `agency_admin`. UI:
`app/agency/commissions/commissions-client.tsx`. The month picker
operates in UTC to line up with the export's UTC day boundary.

### BP3 — Seat-based billing
Plan tiers `starter | team | enterprise` (schema CHECK, migration
`20260509000000_agency_billing.sql` lines 23-24). `lib/agency-seats.ts`
computes `used = members + pending-non-expired invites`
(`countPendingInvites` at line 105 filters `status = 'pending'` AND
`expiresAt > now()`). Critical invariant: `checkSeatCapacity`
FAIL-CLOSES on infra error — if either count sub-query returns null,
the function refuses the invite rather than silently leaking past the
cap (lines 174-185). The `loadPlan` fallback is ALSO fail-closed — a
pre-migration / missing column defaults to `starter / 5`, never
unlimited (lines 37-38, 49-82). Invite endpoints return HTTP 402
`{ code: 'seat_limit' }` when capacity is exhausted. Stripe integration
routes the `scope=agency` checkout branch to the Agency row, and
every webhook handler that writes back goes through
`verifyAgencyOwnsSubscription` to prevent metadata-poisoning (an
attacker setting `metadata.agencyId` to a victim org on their own
sub). UI: `components/agency/seat-usage-pill.tsx` +
`/agency/settings/auto-assignment`.

### BP4 — Deal-at-risk dashboard
Reuses `lib/deals/health.ts` at agency scope — no new tables, no new
migration. `app/agency/pipeline/page.tsx` computes `atRiskCount +
stuckCount` and a per-agent rollup. `HealthDot` uses colour AND shape
so the dashboard reads in monochrome. The "All pipelines healthy"
reassurance card only renders when both counts are zero AND there are
active deals — an empty agency should NOT falsely claim health.

### BP5 — Deal review requests
`DealReviewRequest` + `DealReviewComment` from migration
`20260510000000_deal_review_requests.sql`. Partial unique index
`CREATE UNIQUE INDEX ... idx_dealreview_open_per_deal ON
"DealReviewRequest"("dealId") WHERE status = 'open'` (migration lines
92-93) enforces one open review per deal — the API layer must turn the
resulting 23505 into a 409 Conflict. Status CHECK enum:
`open | approved | closed` (migration lines 26-27). The comments route
`POST /api/agency/reviews/[id]/comments` is the DUAL-AUTH endpoint
documented in §2 — agency member OR the requesting agent
(`review.requestingUserId === dbUser.id`). Resolution via
`PATCH /api/agency/reviews/[id]` sets `resolvedAt` +
`resolvedByUserId` + `status` and is gated to `agency_owner` /
`agency_admin`. Agent-side surface at `/s/[slug]/reviews` is the
Linear Step 1 deliverable.

### BP6 — Playbook template versioning
`AgencyTemplate` (migration
`20260511000000_agency_templates.sql`) replaces the legacy
`title = '[AGENCY_TEMPLATES]'` magic-Note JSON blob; the legacy Note
rows are left in place as a rollback window per the migration header.
The same migration adds `sourceTemplateId` + `sourceVersion` to
`MessageTemplate` (lines 49-53). Publish semantics: on re-publish, the
route detects "agent locally edited" via `sourceVersion IS NULL` and
SKIPS such rows (that's the explicit contract from the migration
comment at lines 46-48). Migration
`20260512000000_template_published_version.sql` adds
`publishedVersion` so the UI compares `version === publishedVersion`
for up-to-date vs amber (replacing the old 1-second-slack
`updatedAt` vs `publishedAt` heuristic described in that migration's
header). Publish fan-out scopes its Space lookup to
`agencyId = caller.agencyId` — the same cross-tenant guard
spirit as the BP3 metadata-poisoning fix.

### BP7 — Lead routing
Two layers in `lib/agency-routing.ts`. Rules layer:
`loadEnabledRules` (line 154) loads `DealRoutingRule` rows
`WHERE agencyId = ? AND enabled = true ORDER BY priority ASC,
createdAt ASC`; `ruleMatches` (line 186) AND-combines criteria
case-insensitively and REJECTS a budget-bounded rule against a
null-budget lead (lines 192-200) — null-budget leads fall through to
the next rule. Destination is XOR-enforced via CHECK
`deal_routing_rule_destination_xor`:
`("destinationUserId" IS NOT NULL AND "destinationPoolMethod" IS NULL)
OR ("destinationUserId" IS NULL AND "destinationPoolMethod" IS NOT NULL)`
(migration `20260514000000_deal_routing_rules.sql` lines 72-76). Pool
method with a `destinationPoolTag` is accepted by the schema and API
but IGNORED by the v1 engine — `resolveRuleDestination` only logs and
continues (lib/agency-routing.ts lines 446-452), because
`AgencyMembership` has no tags column yet (migration header lines
58-63). Don't let the UI promise tag-narrowing. Fallback layer:
`round_robin` honours `Agency.lastAssignedUserId` cursor
(`pickNextAfterCursor` line 313 wraps index 0 when the cursor is null
or stale); `score_based` picks the agent with the fewest active
pipeline Contacts (`type IN ('QUALIFICATION','APPOINTMENT','APPLICATION')`
and not currently snoozed — lines 358-385), ties broken by the same
cursor. Callers: `/api/agencies/leads`, `/api/public/apply/agency`,
and the CRUD routes under `/api/agency/routing-rules[+/[id]]`. UI:
`app/agency/settings/routing-rules/rules-client.tsx`. Hardening
migration `20260515000000_routing_rules_hardening.sql` enabled RLS
with no policies AND flipped `destinationUserId` FK from
`ON DELETE SET NULL` to `ON DELETE CASCADE` — under SET NULL a user
hard-delete would null out `destinationUserId`, trip the XOR CHECK,
and roll back the entire DELETE (header lines 13-22).

### Linear Step 1 — Provider-side reviews
Agent-facing surface at `app/s/[slug]/reviews/*.tsx` (list + detail +
composer). GETs at `/api/space/[slug]/reviews` and
`/api/space/[slug]/reviews/[id]`. These pages re-check the
offboarding gate LOCALLY because server components use `auth()`
directly, not `requireAuth` — the same follow-up documented in §2's
offboarding hard-stop note (commit 4e3fc5e). Comment posting reuses
the agency route `POST /api/agency/reviews/[id]/comments` via the
dual-auth path — there is no duplicate comment endpoint on the space
side.

### Linear Step 2 — Agency activity log
`app/agency/activity` surfaces `AuditLog` rows scoped to the
agency. The scope is the UNION of two predicates:
`(AuditLog.spaceId IN agency.spaceIds)` OR
`(AuditLog.spaceId IS NULL AND metadata->>'agencyId' =
caller.agencyId)` — the null-spaceId branch is why the data-model
section documents `metadata.agencyId` as REQUIRED for
agency-wide events. Pagination cursor is a compound
`<createdAt>|<id>` tuple — a bare ISO cursor missed rows on
millisecond ties until the hardening commit tupled it. The older
aggregator at `/api/agency/activity` (new leads / deals / appointments
feed) was preserved under `/api/agency/team-activity`; its sole
consumer `components/agency/team-activity-feed.tsx` was repointed.

### Linear Step 3 — Lead routing rules v2
This is the `DealRoutingRule` + rule layer already described in BP7.
CRUD routes under `/api/agency/routing-rules` +
`/api/agency/routing-rules/[id]`; UI under
`app/agency/settings/routing-rules`.

---

## 5. Route inventory

One line per route. Method + path + auth + purpose. Enumerated from
`find app/api/agency app/api/agencies app/api/space/[slug]/reviews
app/api/public/apply/agency -name route.ts`.

### `/api/agency/*` — agency control surface

| Method / path | Auth | Purpose |
|---|---|---|
| GET `/api/agency/activity` | `requireAgency` | AuditLog viewer (Linear Step 2); supports `action` / `actorClerkId` / `since` / `cursor` filters |
| GET `/api/agency/team-activity` | `requireAgency` | Legacy aggregator (new leads/deals/appointments feed); preserved for the team-activity-feed widget |
| GET / POST `/api/agency/announcements`, PATCH / DELETE `/[id]` | `requireAgency` | Agency-wide announcement board |
| POST `/api/agency/assign-lead` | `requireAgency` + `canManageLeads` | Manual lead-to-agent assignment |
| POST `/api/agency/unassign-lead` | same | Return a lead to the agency pool |
| GET / POST `/api/agency/chat` | `requireAgency` | Team chat thread |
| POST `/api/agency/chat-command` | `requireAgency` | Slash-command dispatch |
| POST `/api/agency/chat-notify` | `requireAgency` | Team-chat notification fan-out |
| PATCH `/api/agency/commissions/ledger/[id]` | `agency_owner / agency_admin` | Adjust a ledger row; enforces rate-sum ≤ 100 + referral invariant (BP2) |
| GET `/api/agency/commissions/export?month=YYYY-MM` | `agency_owner / agency_admin` | Month CSV export, UTC bucketed |
| POST `/api/agency/create` | signed-in | Mint a new Agency; promotes caller to `agency_owner` |
| GET `/api/agency/export` | `requireAgency` | CSV of team-wide metrics |
| GET / POST / PATCH `/api/agency/form-config` | `agency_owner / agency_admin` | Agency intake form schema |
| DELETE `/api/agency/invitations/[id]` | `agency_owner / agency_admin` | Revoke a pending invite |
| POST `/api/agency/invite` | `agency_owner / agency_admin` | Single-email invite; 402 `{ code: 'seat_limit' }` on cap (BP3) |
| POST `/api/agency/invite/bulk` | same | Bulk invite list; same 402 semantics |
| POST `/api/agency/join` | signed-in | Accept an invite by token |
| GET / POST `/api/agency/join-code` | `agency_owner` | Rotate the public join code |
| POST `/api/agency/lead-note` | `requireAgency` | Attach a note to an assigned lead |
| GET `/api/agency/leads` | `requireAgency` | Agency lead queue |
| DELETE `/api/agency/members/[id]` | `agency_owner / agency_admin` | Remove membership (soft — no data transfer) |
| POST `/api/agency/members/[id]/offboard` | `agency_owner` | **Atomic transfer + offboard** (BP1); `{ dryRun: true }` returns counts |
| GET `/api/agency/notifications` | `requireAgency` | `AgencyNotification` inbox |
| GET `/api/agency/providers` | `requireAgency` | Roster + status |
| GET `/api/agency/reviews?status=...` | `requireAgency` (member+) | Review queue (BP5) |
| GET `/api/agency/reviews/[id]` | GET any member | Review detail |
| PATCH `/api/agency/reviews/[id]` | `agency_owner / agency_admin` | Resolve (approve / close) |
| POST `/api/agency/reviews/[id]/comments` | **dual-auth** — agency member OR `review.requestingUserId` | Comment; 409 when review is resolved |
| GET / POST `/api/agency/routing-rules` | GET member; POST owner/admin | Lead-routing rules (BP7 layer 1) |
| PATCH / DELETE `/api/agency/routing-rules/[id]` | owner/admin | Edit / delete a rule |
| GET `/api/agency/settings` | `requireAgency` member | Agency settings read |
| PATCH `/api/agency/settings` | owner/admin | Update plan / rates / auto-assign |
| GET `/api/agency/stats` | `requireAgency` | Team-wide KPI roll-up |
| GET / POST `/api/agency/templates` | GET member; POST owner/admin | AgencyTemplate CRUD (BP6) |
| PATCH / DELETE `/api/agency/templates/[id]` | owner/admin | Edit / delete + auto-bump `version` |
| POST `/api/agency/templates/[id]/publish` | owner/admin | Fan-out to provider_members; skips `sourceVersion IS NULL` rows |
| GET `/api/agency/trends` | `requireAgency` | Time-series metrics for the dashboard |

### `/api/agencies/*` — less-gated agency entry points

| Method / path | Auth | Purpose |
|---|---|---|
| POST `/api/agencies/leads` | `requireAgency` + `canManageLeads` | Manual agency-add lead; calls `routeAgencyLead` before insert |

### `/api/space/[slug]/reviews/*` — provider-side reviews (Linear Step 1)

| Method / path | Auth | Purpose |
|---|---|---|
| GET `/api/space/[slug]/reviews?status=...` | `requireSpaceOwner` + local `User.status` re-check | Provider's own flagged reviews |
| GET `/api/space/[slug]/reviews/[id]` | same + `requestingUserId` match | Single review + comment thread |

Comments POST reuses the shared `/api/agency/reviews/[id]/comments`
endpoint via the dual-auth rule — no duplicate route.

### `/api/public/apply/agency` — public lead intake

| Method / path | Auth | Purpose |
|---|---|---|
| POST `/api/public/apply/agency` | **public** — captcha + per-IP rate limit | Inbound lead; calls `routeAgencyLead` with `leadType / budget / tags` so rules evaluate before insert |

### Billing + webhooks

| Method / path | Auth | Purpose |
|---|---|---|
| POST `/api/billing/checkout` | signed-in; `scope: 'agency'` branch requires `agency_owner` | Create Stripe checkout session for the agency plan |
| POST `/api/webhooks/stripe` | Stripe signature | Subscription lifecycle → `Agency`; **every write passes `verifyAgencyOwnsSubscription`** (metadata-poisoning guard) |

---

## 6. Audit logging

All sensitive writes go through `lib/audit.ts`. The `AuditAction` union
at lib/audit.ts:25-36 is the source of truth for what's loggable:
`CREATE | UPDATE | DELETE | ACCESS | LOGIN | LOGOUT | ADMIN_ACTION |
OFFBOARD`. Extending it for a new write category is a one-line change
plus the call-site usage; **don't silently cast `as AuditAction`** —
the BP1 audit flagged exactly that pattern.

**Call-site convention.** Fire-and-forget via `void audit({ ... })`
**after** the DB write succeeds. Arguments:

- `actorClerkId` — `null` for system events (cron, webhooks with no
  user context); the Clerk id otherwise.
- `action` — one of the union values.
- `resource` — table name (e.g. `'AgencyMembership'`).
- `resourceId` — primary key of the affected row.
- `spaceId` — the workspace scope; **`undefined` for agency-wide
  writes** (invites, member removals, template publishes). The
  `AuditLog.spaceId` column is nullable for exactly this reason.
- `metadata` — freeform `jsonb`. **Must include `agencyId`** for
  agency-wide writes so the `/agency/activity` viewer's null-space
  scoping can find the row (see §4 Step 2).
- `req` — pass the `NextRequest` for IP extraction.

**Metadata hygiene.** Treat `metadata` as user-visible. The
`/agency/activity` UI expands the full JSON on row-click (see
`activity-client.tsx`). Do NOT log tokens, password-reset values, raw
email bodies, Stripe secrets, or anything else a agency reading the
log shouldn't see. A grep-based CI guard would catch most leaks; it
doesn't exist yet (§7).

**Visibility.** `/agency/activity` (Linear Step 2) scopes by
`spaceId ∈ agency.spaces` UNION `spaceId IS NULL AND
metadata->>agencyId = caller's agencyId`. Cursor is compound
`<createdAt>|<id>` to be tie-safe on millisecond collisions.

---

## 7. Known gaps

Tracked trade-offs and scope-deferred items. All deliberate; called
out in the commits that shipped the surrounding feature.

- **Priority-reorder race on DealRoutingRule.** Two admins clicking
  the up/down arrows simultaneously can produce duplicate
  priorities. The engine tie-breaks on `createdAt ASC` so routing
  stays deterministic, but the UI shows matching numbers until a
  page refresh. Proper fix: a batched reorder endpoint that
  renumbers in a transaction.
- **`destinationPoolTag` accepted but ignored.** The schema + API
  accept a tag for pool narrowing, but the engine does nothing with
  it pending a `AgencyMembership.tags` column. The UI has a
  placeholder explainer so agencies aren't surprised.
- **Agency notifications on routing assignment skipped.** Intentional
  — the agency already knows leads arrive; a per-lead
  `AgencyNotification` would be noise. If product asks, add a
  `'lead_assigned'` `AgencyNotificationType` and fire it from the
  two routing callers.
- **No audit row for SMS deliveries.** `lib/sms.ts` is
  fire-and-forget (silently no-ops when Telnyx env is missing). The
  `send_sms` tool logs a `ContactActivity` for the CRM-side feed,
  but no `audit()` call — so agency compliance reports miss SMS
  activity. Adding one is a two-line change.
- **No lint / CI guard on `AuditLog.metadata`.** A writer that
  accidentally logs a sensitive field leaks into
  `/agency/activity`. A typed `AuditMetadata` discriminated union
  keyed by `AuditAction` would close this at compile time; a
  grep-based pre-commit is the cheaper MVP.
- **`User.status = 'offboarded'` is global.** Offboarding from the
  LAST agency locks the user out of Koala entirely
  (intentional). Per-agency "soft suspension" isn't modelled —
  use `AgencyMembership` row removal for that case.
- **No per-agent availability / DND.** The routing engine doesn't
  check whether an agent is on vacation; a real implementation
  would need a `User.availability` column and engine
  short-circuit.
- **Priority integer instead of fractional ranks.** `DealRoutingRule.priority`
  is an `integer`, so inserting between rules 100 and 101 requires
  renumbering. A fractional rank would avoid the rebalance; not
  worth the complexity at current agency scale.
