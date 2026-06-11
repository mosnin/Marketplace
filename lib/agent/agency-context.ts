/**
 * Server-side permission resolver for the agency Koala surface
 * (`/agency/koala` → `/api/ai/agency-task`).
 *
 * This is defense layer 2 of three (per AGENTS.md and the Koala-for-Agencies
 * Phase 1 spec):
 *
 *   1. ROUTE GUARD   — `app/agency/koala/page.tsx` server component
 *                      redirects when the caller isn't a agency.
 *   2. API GATE      — this module. `app/api/ai/agency-task/route.ts` calls
 *                      `resolveAgencyContext()` before forwarding to Modal.
 *                      A provider_member trying to hit the agency chat —
 *                      even if they slip past the route guard somehow —
 *                      receives a 403 right here.
 *   3. TOOL-RUNTIME  — `agent/tools/agency/_guards.py:require_agency_role`
 *                      refuses tool execution unless AgentContext carries
 *                      a agency role. Phase 2/3 tools wrap every handler
 *                      body with that check.
 *
 * Layer 2 lives in its own module (not as ad-hoc code inside the route) so
 * the next route Phase 2/3 adds can reuse the same gate without copying
 * the logic — and so the contract for "what counts as agency access" is
 * single-source-of-truth.
 */

import { getAgencyMemberContext } from '@/lib/permissions';
import type { Agency, AgencyMembership } from '@/lib/types';

/**
 * Roles allowed to use the agency chat surface.
 *
 * `provider_member` is excluded by design — a provider inside a agency
 * already has their own Koala at `/s/<slug>/koala`. The agency chat is
 * the chief-of-staff variant, scoped to agency-wide operations, and
 * provider_members do not run those operations.
 */
const AGENCY_ROLES = ['agency_owner', 'agency_admin'] as const;
type AgencyRole = (typeof AGENCY_ROLES)[number];

export interface AgencyAgentContext {
  /** Agency row the caller has admin/owner access to. */
  agency: Agency;
  /** Their AgencyMembership row — role and ids. */
  membership: AgencyMembership;
  /** Internal `User.id` (NOT Clerk id). Same shape as other helpers expose. */
  dbUserId: string;
  /** Narrowed role — guaranteed one of `AGENCY_ROLES` after this resolves. */
  agencyRole: AgencyRole;
}

/**
 * Resolve the calling Clerk user to a agency-admin-or-owner context, or
 * `null` if they are not a agency.
 *
 * Returns `null` when:
 *   - The user is not signed in (no Clerk session).
 *   - The user has no `AgencyMembership` of any kind.
 *   - The user IS a agency member but only as `provider_member` — the
 *     agency chat surface is not theirs.
 *   - The user's `User.status` is `offboarded` (handled inside
 *     `getAgencyMemberContext` already, propagated through the null).
 *
 * On success returns the agency, membership, internal user id, and a
 * narrowed `agencyRole` field the caller can forward to Modal without
 * re-running its own role check.
 *
 * Reuses `getAgencyMemberContext()` from `lib/permissions.ts:121` — does
 * not duplicate the membership / agency / offboarding lookups, so any
 * future change to "what does agency auth mean" lives in one place.
 */
export async function resolveAgencyContext(): Promise<AgencyAgentContext | null> {
  const ctx = await getAgencyMemberContext();
  if (!ctx) return null;

  // `getAgencyMemberContext` accepts provider_member too — it's the helper
  // for "any agency member, including providers". We filter HERE so the
  // gate exposes a single intent: the agency chat is for agencies.
  const role = ctx.membership.role;
  if (role !== 'agency_owner' && role !== 'agency_admin') {
    return null;
  }

  return {
    agency: ctx.agency,
    membership: ctx.membership,
    dbUserId: ctx.dbUserId,
    agencyRole: role,
  };
}
