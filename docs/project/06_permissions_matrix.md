# 06 Permissions Matrix

## Roles

- **Platform Admin** (User.platformRole = 'admin'): System-level access. Can view all users, agencies, and invitations. One or more per platform.
- **Agency Owner** (AgencyMembership.role = 'agency_owner'): Owns a agency. Full access to agency portal. One per agency.
- **Agency Manager** (AgencyMembership.role = 'agency_admin'): Manages a agency. Same as owner except cannot delete agency.
- **Provider Member** (AgencyMembership.role = 'provider_member'): Member of a agency. Has own workspace. Sees agency name in sidebar.
- **Solo Provider** (default, no agency membership): Owns their workspace. Full access to their space.

## Route Access Matrix

| Route | Platform Admin | Agency Owner | Agency Manager | Provider Member | Solo Provider | Public |
|-------|---------------|-------------|----------------|----------------|-------------|--------|
| / (home/sign-in) | redirect | redirect | redirect | redirect | redirect | full |
| /sign-in, /sign-up | redirect | redirect | redirect | redirect | redirect | full |
| /login/agency | redirect | redirect | redirect | redirect | redirect | full |
| /login/provider | redirect | redirect | redirect | redirect | redirect | full |
| /dashboard | full | full | full | full | full | none |
| /setup | full | full | full | full | full | none |
| /s/[slug] (own space) | full | full | full | full | full | none |
| /s/[slug]/leads | full | full | full | full | full | none |
| /s/[slug]/contacts | full | full | full | full | full | none |
| /s/[slug]/deals | full | full | full | full | full | none |
| /s/[slug]/appointments | full | full | full | full | full | none |
| /s/[slug]/analytics | full | full | full | full | full | none |
| /s/[slug]/ai | full | full | full | full | full | none |
| /s/[slug]/profile | full | full | full | full | full | none |
| /s/[slug]/settings | full | full | full | full | full | none |
| /s/[slug]/configure | full | full | full | full | full | none |
| /s/[slug]/billing | full | full | full | full | full | none |
| /agency | none | full | full | none | none | none |
| /agency/providers | none | full | full | none | none | none |
| /agency/members | none | full | full | none | none | none |
| /agency/invitations | none | full | full | none | none | none |
| /agency/settings | none | full | view | none | none | none |
| /admin | full | none | none | none | none | none |
| /admin/users | full | none | none | none | none | none |
| /admin/agencies | full | none | none | none | none | none |
| /admin/invitations | full | none | none | none | none | none |
| /apply/[slug] | full | full | full | full | full | full |
| /book/[slug] | full | full | full | full | full | full |
| /invite/[token] | full | full | full | full | full | full |
| /join/[code] | full | full | full | full | full | full |
| /pricing | full | full | full | full | full | full |
| /features | full | full | full | full | full | full |
| /faq | full | full | full | full | full | full |
| /legal/* | full | full | full | full | full | full |

## Enforcement Rules

- **Middleware layer** (`middleware.ts`): Clerk middleware protects all routes matching `/dashboard`, `/s/*`, `/setup`, `/admin`, `/agency`, `/invite/*`, `/join/*`, `/auth/*`. Admin routes additionally check `sessionClaims.publicMetadata.role === 'admin'`.
- **API layer**: Each API route calls `auth()` for userId. Admin routes call `requirePlatformAdmin()`. Agency routes call `requireAgency()`. Space routes verify space ownership via `getCurrentDbUser()` + space lookup.
- **UI layer**: Sidebar conditionally shows agency nav link based on `isAgency` prop. Admin nav only shown to admins. Agency name shown to agency members.
- **Data isolation**: All space data is filtered by `spaceId`. Layout verifies `dbUser.space.id === space.id` to prevent cross-space access.

## Notes

- Platform Admin is assigned via User.platformRole in DB or Clerk publicMetadata.role (backwards compat).
- Agency roles are derived from AgencyMembership records, not User fields.
- A user can be both a provider (own space) and a agency (accountType='both').
- Space ownership is 1:1 — one user, one space. Space.ownerId is UNIQUE.
- Authenticated users visiting sign-in/sign-up pages are redirected to `/`.
