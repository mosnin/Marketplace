/**
 * Composio entity-id namespacing for agency-level connections.
 *
 * Composio scopes connections per "entity". The provider flow uses the bare
 * Clerk userId as the entity, which means a provider's personal Gmail and the
 * SAME person's agency-level Gmail would collide on one Composio entity if
 * we reused the userId. Namespacing the agency entity keeps the two
 * connections distinct, so an agency can connect one inbox personally and a
 * different one at the agency level.
 *
 * The shape is `agency:<agencyId>:<userId>` — deterministic, so the
 * connect route and the callback resolve to the same entity.
 */

const PREFIX = 'agency';

export function agencyEntityId(args: { agencyId: string; userId: string }): string {
  return `${PREFIX}:${args.agencyId}:${args.userId}`;
}
