/**
 * Speed-to-lead enforcement — the agentic half of agency lead routing.
 *
 * Routing already puts a lead in a provider's hands (auto-assign + DealRoutingRule
 * → a Contact clone tagged `assigned-by-agency` in the provider's space). This is
 * the part that makes sure it's actually WORKED: a sweep that finds routed leads
 * sitting un-touched past the agency's SLA and acts on the agency's behalf —
 * nudging the provider first, escalating to the agency if it stays cold.
 *
 * Detection needs no extra schema:
 *   - a routed lead  = Contact in a member space tagged `assigned-by-agency`
 *   - un-worked      = `lastContactedAt IS NULL`
 *   - the clock      = the clone's `createdAt` (= assignment time)
 *
 * Idempotency is carried on the contact's own tags: once Koala nudges it gets
 * `sla-nudged`; once it escalates it gets `sla-escalated`. The sweep skips a
 * lead it has already acted on at that level, so running every 15 minutes never
 * double-pings.
 */

import { supabase } from '@/lib/supabase';
import { getAgencyMembers } from '@/lib/agency-members';
import { notifyAgency } from '@/lib/agency-notify';
import { sendPushToSpace } from '@/lib/push';
import { logger } from '@/lib/logger';

export interface AgencySlaPolicy {
  id: string;
  name: string;
  slaFirstResponseMinutes: number;
  slaEscalateMinutes: number;
}

export interface SlaSweepResult {
  agencyId: string;
  breached: number;
  nudged: number;
  escalated: number;
}

const NUDGED_TAG = 'sla-nudged';
const ESCALATED_TAG = 'sla-escalated';

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/**
 * Run the speed-to-lead sweep for one agency. Best-effort throughout — a
 * single contact failing never aborts the rest. Returns what Koala did.
 */
export async function sweepAgencySla(agency: AgencySlaPolicy): Promise<SlaSweepResult> {
  const result: SlaSweepResult = { agencyId: agency.id, breached: 0, nudged: 0, escalated: 0 };

  // ── Member spaces + provider names ──────────────────────────────────────────
  const members = await getAgencyMembers(agency.id, { includeSpaceName: true });
  const spaceIds: string[] = [];
  const spaceToProvider = new Map<string, string>();
  for (const m of members) {
    const sid = m.Space?.id;
    if (!sid) continue;
    spaceIds.push(sid);
    spaceToProvider.set(sid, m.User?.name ?? m.User?.email ?? 'a provider');
  }
  if (spaceIds.length === 0) return result;

  // First-response threshold: any routed lead created before this has now sat
  // longer than the agency allows.
  const firstThreshold = new Date(Date.now() - agency.slaFirstResponseMinutes * 60000).toISOString();

  const { data, error } = await supabase
    .from('Contact')
    .select('id, name, spaceId, tags, createdAt, lastContactedAt')
    .in('spaceId', spaceIds)
    .contains('tags', ['assigned-by-agency'])
    .is('lastContactedAt', null)
    .lte('createdAt', firstThreshold)
    .limit(2000);
  if (error) {
    logger.error('[agency-sla] breach query failed', { agencyId: agency.id }, error);
    return result;
  }

  const rows = (data ?? []) as {
    id: string;
    name: string;
    spaceId: string;
    tags: string[] | null;
    createdAt: string;
  }[];

  for (const c of rows) {
    const tags = c.tags ?? [];
    const waited = minutesSince(c.createdAt);
    const provider = spaceToProvider.get(c.spaceId) ?? 'a provider';
    result.breached += 1;

    try {
      // Past the escalation window → the provider has had their chance; pull in
      // the agency (their decision whether to reassign — nothing fires without
      // a human's name on it).
      if (waited >= agency.slaEscalateMinutes) {
        if (tags.includes(ESCALATED_TAG)) continue;
        await notifyAgency({
          agencyId: agency.id,
          type: 'review_requested',
          title: `${c.name} still hasn't been contacted`,
          body: `Assigned to ${provider} ${waited} minutes ago and still no first response. Reassign or step in.`,
          metadata: { kind: 'lead_sla_breach', contactId: c.id, spaceId: c.spaceId, provider, waitedMinutes: waited },
        });
        await supabase
          .from('Contact')
          .update({ tags: [...tags, ESCALATED_TAG] })
          .eq('id', c.id);
        result.escalated += 1;
        continue;
      }

      // Past first-response but inside the escalation window → nudge the provider.
      if (tags.includes(NUDGED_TAG)) continue;
      await sendPushToSpace(c.spaceId, {
        title: 'A lead is waiting on you',
        body: `${c.name} has been waiting ${waited} minutes. Reach out now.`,
      }).catch(() => 0);
      await supabase
        .from('Contact')
        .update({ tags: [...tags, NUDGED_TAG] })
        .eq('id', c.id);
      result.nudged += 1;
    } catch (err) {
      logger.warn('[agency-sla] action failed for contact', { agencyId: agency.id, contactId: c.id }, err);
    }
  }

  return result;
}

/**
 * Run the sweep for every agency that has SLA enforcement on. Used by the
 * cron route.
 */
export async function sweepAllAgencies(): Promise<SlaSweepResult[]> {
  const { data, error } = await supabase
    .from('Agency')
    .select('id, name, slaFirstResponseMinutes, slaEscalateMinutes')
    .eq('slaEnabled', true)
    .limit(5000);
  if (error) {
    logger.error('[agency-sla] failed to load agencies', {}, error);
    return [];
  }
  const policies = (data ?? []) as AgencySlaPolicy[];
  const out: SlaSweepResult[] = [];
  for (const p of policies) {
    try {
      out.push(await sweepAgencySla(p));
    } catch (err) {
      logger.error('[agency-sla] agency sweep threw', { agencyId: p.id }, err);
    }
  }
  return out;
}
