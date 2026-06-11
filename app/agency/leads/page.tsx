import { requireAgency } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { redirect } from 'next/navigation';
import { getAgencyMembers } from '@/lib/agency-members';
import type { Metadata } from 'next';
import { H1, TITLE_FONT, BODY_MUTED } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { AgencyLeadsClient, type LeadRow, type ProviderOption, type AssignedLeadProgress } from './agency-leads-client';

export const metadata: Metadata = { title: 'Leads — Teams' };

export default async function AgencyLeadsPage() {
  let ctx;
  try {
    ctx = await requireAgency();
  } catch {
    redirect('/');
  }

  const { agency } = ctx;

  // 1. AGENCY LEADS — from agency intake form
  // Primary path: agencyId is set.
  const { data: agencyAllByAgencyId } = await supabase
    .from('Contact')
    .select('id, name, email, phone, budget, scoreLabel, leadScore, leadType, tags, createdAt, notes, applicationData, applicationStatusNote')
    .eq('agencyId', agency.id)
    .order('createdAt', { ascending: false })
    .limit(500);

  // Legacy compatibility: include agency-tagged leads that were saved into
  // the agency owner's space before agencyId was consistently populated.
  const { data: ownerSpaces } = await supabase
    .from('Space')
    .select('id')
    .eq('ownerId', agency.ownerId)
    .limit(10);
  const ownerSpaceIds = (ownerSpaces ?? []).map((s: { id: string }) => s.id);

  const { data: agencyUnassignedLegacy } = ownerSpaceIds.length > 0
    ? await supabase
        .from('Contact')
        .select('id, name, email, phone, budget, scoreLabel, leadScore, leadType, tags, createdAt, notes, applicationData, applicationStatusNote')
        .in('spaceId', ownerSpaceIds)
        .is('agencyId', null)
        .contains('tags', ['agency-lead'])
        .order('createdAt', { ascending: false })
        .limit(200)
    : { data: [] };
  const agencyAll = [
    ...(agencyAllByAgencyId ?? []),
    ...((agencyUnassignedLegacy ?? []).filter(
      (c: any) => !(agencyAllByAgencyId ?? []).some((p: any) => p.id === c.id)
    )),
  ];
  const agencyUnassigned = agencyAll.filter((c: any) => !(c.tags ?? []).includes('assigned'));
  const agencyAssigned = agencyAll.filter((c: any) => (c.tags ?? []).includes('assigned'));

  // 2. MEMBER LEADS — from individual provider intake forms, visible to admins
  const allMembers = await getAgencyMembers(agency.id, { includeSpaceName: true });
  const memberSpaceIds = allMembers.map((m) => m.Space?.id).filter(Boolean) as string[];

  // Agency leads list should only include leads captured via agency intake.
  const unassignedRaw = agencyUnassigned ?? [];

  const assignedRaw = agencyAssigned ?? [];
  const members = allMembers;

  // Get lead counts per provider space
  const providerSpaceIds = members.map((m) => m.Space?.id).filter(Boolean) as string[];
  const { data: leadCounts } = providerSpaceIds.length > 0
    ? await supabase
        .from('Contact')
        .select('spaceId')
        .in('spaceId', providerSpaceIds)
        .limit(10000)
    : { data: [] };

  const countBySpace = (leadCounts ?? []).reduce<Record<string, number>>(
    (acc, r: { spaceId: string }) => {
      acc[r.spaceId] = (acc[r.spaceId] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const providers: ProviderOption[] = members.map((m) => ({
    userId: m.userId,
    name: m.User?.name ?? null,
    email: m.User?.email ?? '',
    spaceId: m.Space?.id ?? null,
    leadCount: m.Space?.id ? (countBySpace[m.Space?.id] ?? 0) : 0,
  }));

  type RawContact = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    budget: number | null;
    scoreLabel: string | null;
    leadScore: number | null;
    tags: string[];
    createdAt: string;
    notes: string | null;
    applicationData: Record<string, unknown> | null;
    applicationStatusNote?: string | null;
  };

  // Build a map of userId -> provider name for resolving assignments
  const providerNameMap = new Map<string, string>();
  for (const m of members) {
    providerNameMap.set(m.userId, m.User?.name ?? m.User?.email ?? 'Unknown');
  }

  // ── Parse assignment metadata from assigned contacts ──────────────────
  type AssignmentMeta = {
    assignedTo: string;
    assignedToName: string;
    assignedContactId: string;
    assignedSpaceId: string;
    assignedAt: string;
  };

  const assignmentMap = new Map<string, AssignmentMeta>();
  const providerContactIds: string[] = [];

  for (const c of (assignedRaw ?? []) as RawContact[]) {
    if (c.applicationStatusNote) {
      try {
        const meta = JSON.parse(c.applicationStatusNote) as AssignmentMeta;
        assignmentMap.set(c.id, meta);
        if (meta.assignedContactId) {
          providerContactIds.push(meta.assignedContactId);
        }
      } catch {
        // Legacy format or invalid JSON — fall back to notes parsing
      }
    }
  }

  // ── Fetch provider-side contact progress for assigned leads ────────────
  type ProviderContact = {
    id: string;
    type: string;
    leadScore: number | null;
    scoreLabel: string | null;
    followUpAt: string | null;
    lastContactedAt: string | null;
    updatedAt: string;
  };

  const { data: providerContacts } = providerContactIds.length > 0
    ? await supabase
        .from('Contact')
        .select('id, type, leadScore, scoreLabel, followUpAt, lastContactedAt, updatedAt')
        .in('id', providerContactIds)
        .limit(500)
    : { data: [] };

  const providerContactMap = new Map<string, ProviderContact>();
  for (const rc of (providerContacts ?? []) as ProviderContact[]) {
    providerContactMap.set(rc.id, rc);
  }

  // ── Fetch deals linked to provider-side contacts ───────────────────────
  const { data: dealContactLinks } = providerContactIds.length > 0
    ? await supabase
        .from('DealContact')
        .select('dealId, contactId')
        .in('contactId', providerContactIds)
        .limit(500)
    : { data: [] };

  const contactHasDeal = new Set<string>();
  for (const dc of (dealContactLinks ?? []) as { dealId: string; contactId: string }[]) {
    contactHasDeal.add(dc.contactId);
  }

  // ── Build progress map keyed by agency contact ID ─────────────────────
  const progressMap = new Map<string, AssignedLeadProgress>();

  for (const [agencyContactId, meta] of assignmentMap) {
    const rc = providerContactMap.get(meta.assignedContactId);
    progressMap.set(agencyContactId, {
      providerName: meta.assignedToName,
      assignedAt: meta.assignedAt,
      assignedContactId: meta.assignedContactId,
      assignedSpaceId: meta.assignedSpaceId,
      currentStage: (rc?.type as AssignedLeadProgress['currentStage']) ?? 'QUALIFICATION',
      currentScore: rc?.leadScore ?? null,
      currentScoreLabel: rc?.scoreLabel ?? null,
      lastActivityAt: rc?.lastContactedAt ?? rc?.updatedAt ?? null,
      hasFollowUp: rc?.followUpAt != null,
      followUpAt: rc?.followUpAt ?? null,
      hasDeal: contactHasDeal.has(meta.assignedContactId),
    });
  }

  function toLeadRow(c: RawContact): LeadRow {
    const moveTiming = c.applicationData?.targetMoveInDate as string | undefined;

    // Try structured metadata first, fall back to notes parsing
    const meta = assignmentMap.get(c.id);
    let assignedName: string | null = null;
    let assignedAt: string | null = null;

    if (meta) {
      assignedName = meta.assignedToName;
      assignedAt = meta.assignedAt;
    } else {
      // Legacy: parse from notes
      const providerIdMatch = c.notes?.match(/Assigned to provider \(([^)]+)\)/);
      assignedName = providerIdMatch?.[1]
        ? providerNameMap.get(providerIdMatch[1]) ?? 'Provider'
        : null;
      const dateMatch = c.notes?.match(/Assigned to provider .+ on (\S+)/);
      assignedAt = dateMatch?.[1] ?? (c.tags.includes('assigned') ? c.createdAt : null);
    }

    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      budget: c.budget,
      scoreLabel: c.scoreLabel,
      leadScore: c.leadScore,
      leadType: (c as any).leadType ?? 'rental',
      moveTiming: moveTiming ?? null,
      createdAt: c.createdAt,
      assignedTo: assignedName,
      assignedAt,
    };
  }

  const unassignedLeads: LeadRow[] = (unassignedRaw ?? []).map((c: unknown) => toLeadRow(c as RawContact));
  const assignedLeads: LeadRow[] = (assignedRaw ?? []).map((c: unknown) => toLeadRow(c as RawContact));

  // Serialize progress map for client
  const assignedLeadProgress: Record<string, AssignedLeadProgress> = {};
  for (const [id, progress] of progressMap) {
    assignedLeadProgress[id] = progress;
  }

  // ── Page-scoped narration. Pick the loudest fact for THIS page: routing
  // load, hot pipeline waiting on someone, or "caught up." Hand-coded ladder.
  const subtitle = (() => {
    const unassignedCount = unassignedLeads.length;
    if (unassignedCount > 0) {
      return `${unassignedCount} ${unassignedCount === 1 ? 'lead' : 'leads'} landed unassigned. Route ${unassignedCount === 1 ? 'it' : 'them'}.`;
    }
    const hotAssigned = assignedLeads.filter(
      (l) => l.scoreLabel?.toLowerCase() === 'hot',
    ).length;
    if (hotAssigned > 0) {
      return `${hotAssigned} hot ${hotAssigned === 1 ? 'lead' : 'leads'} on a provider's plate. Check in.`;
    }
    const total = unassignedCount + assignedLeads.length;
    if (total === 0) {
      return 'No leads yet. The intake form is waiting.';
    }
    return `Caught up. ${total} ${total === 1 ? 'lead' : 'leads'} in the agency.`;
  })();

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Leads.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          Your agency&rsquo;s intake
        </h1>
        <p className={cn(BODY_MUTED)}>{subtitle}</p>
      </header>

      <AgencyLeadsClient
        unassignedLeads={unassignedLeads}
        assignedLeads={assignedLeads}
        providers={providers}
        assignedLeadProgress={assignedLeadProgress}
      />
    </div>
  );
}
