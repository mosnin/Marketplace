import { supabase } from '@/lib/supabase';
import { getSpaceByOwnerId } from '@/lib/space';
import { notifyNewLead } from '@/lib/notify';

export type AssignLeadResult =
  | { ok: true; newContactId: string; assignedToSpaceId: string }
  | { ok: false; error: string; status: number };

/**
 * Assign an agency lead (Contact) from the agency's space into a provider's
 * space: clone the contact, mark the original as assigned, notify the provider.
 *
 * Shared by POST /api/agency/assign-lead and the /assign team-chat command so
 * the two can never drift. Callers MUST verify the caller is an agency who can
 * manage leads before calling this — it performs no auth of its own.
 */
export async function assignLeadToProvider(params: {
  agency: { id: string; ownerId: string; name: string };
  assignedByUserId: string;
  contactId: string;
  providerUserId: string;
}): Promise<AssignLeadResult> {
  const { agency, assignedByUserId, contactId, providerUserId } = params;

  // ── Find the agency's space ────────────────────────────────────────────
  const agencySpace = await getSpaceByOwnerId(agency.ownerId);
  if (!agencySpace) {
    return { ok: false, error: 'Agency space not found', status: 500 };
  }

  // ── Verify the contact belongs to this agency ───────────────────────
  // Accept contacts in the agency owner's space (legacy path) OR contacts
  // where agencyId is explicitly set (modern intake path).
  const { data: contactInSpace, error: contactError } = await supabase
    .from('Contact')
    .select('*')
    .eq('id', contactId)
    .eq('spaceId', agencySpace.id)
    .maybeSingle();
  if (contactError) throw contactError;

  let contact = contactInSpace;
  if (!contact) {
    const { data: contactByAgencyId, error: agencyContactError } = await supabase
      .from('Contact')
      .select('*')
      .eq('id', contactId)
      .eq('agencyId', agency.id)
      .maybeSingle();
    if (agencyContactError) throw agencyContactError;
    contact = contactByAgencyId;
  }

  if (!contact) {
    return { ok: false, error: 'Contact not found in your agency space', status: 404 };
  }

  // ── Verify the provider is a member of this agency ───────────────────
  const { data: providerMembership, error: memberError } = await supabase
    .from('AgencyMembership')
    .select('id, role, userId')
    .eq('agencyId', agency.id)
    .eq('userId', providerUserId)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!providerMembership) {
    return { ok: false, error: 'User is not a member of this agency', status: 403 };
  }

  // ── Find the provider's space ───────────────────────────────────────────
  const providerSpace = await getSpaceByOwnerId(providerUserId);
  if (!providerSpace) {
    return { ok: false, error: 'Member does not have a workspace yet', status: 404 };
  }

  // ── Fetch the provider's name ───────────────────────────────────────────
  const { data: providerUser } = await supabase
    .from('User')
    .select('name, email')
    .eq('id', providerUserId)
    .maybeSingle();
  const providerName = providerUser?.name ?? providerUser?.email ?? providerUserId;

  // ── Prevent double-assignment ──────────────────────────────────────────
  const existingTags: string[] = contact.tags ?? [];
  if (existingTags.includes('assigned')) {
    return { ok: false, error: 'This lead has already been assigned', status: 409 };
  }

  // ── Clone the contact into the provider's space ─────────────────────────
  const newContactId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: cloneError } = await supabase.from('Contact').insert({
    id: newContactId,
    spaceId: providerSpace.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    budget: contact.budget,
    preferences: contact.preferences,
    address: contact.address,
    notes: contact.notes,
    type: contact.type,
    services: contact.services ?? [],
    tags: ['assigned-by-agency', 'new-lead'],
    scoringStatus: contact.scoringStatus,
    leadScore: contact.leadScore,
    scoreLabel: contact.scoreLabel,
    scoreSummary: contact.scoreSummary,
    scoreDetails: contact.scoreDetails,
    sourceLabel: `agency: ${agency.name}`,
    applicationData: contact.applicationData,
    applicationRef: contact.applicationRef,
    applicationStatus: contact.applicationStatus,
  });
  if (cloneError) throw cloneError;

  // ── Mark the original contact as assigned ──────────────────────────────
  const assignmentNote = [
    contact.notes,
    `\nAssigned to: ${providerName}`,
    `--- Assigned to provider (${providerUserId}) on ${now} by ${assignedByUserId} ---`,
  ]
    .filter(Boolean)
    .join('\n');

  const assignmentMeta = JSON.stringify({
    assignedTo: providerUserId,
    assignedToName: providerName,
    assignedContactId: newContactId,
    assignedSpaceId: providerSpace.id,
    assignedAt: now,
  });

  const { error: updateError } = await supabase
    .from('Contact')
    .update({
      tags: [...existingTags.filter((t: string) => t !== 'new-lead'), 'assigned'],
      notes: assignmentNote,
      applicationStatus: 'assigned',
      applicationStatusNote: assignmentMeta,
      updatedAt: now,
    })
    .eq('id', contactId);
  if (updateError) throw updateError;

  console.info('[assign-lead] lead assigned', {
    contactId,
    newContactId,
    agencyId: agency.id,
    providerUserId,
    assignedBy: assignedByUserId,
  });

  // ── Notify the provider (best-effort — never fail the assignment) ───────
  try {
    await notifyNewLead({
      spaceId: providerSpace.id,
      contactId: newContactId,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      leadScore: contact.leadScore,
      scoreLabel: contact.scoreLabel,
      scoreSummary: contact.scoreSummary,
      applicationData: contact.applicationData,
    });
  } catch (e) {
    console.error('[assign-lead] notification failed:', { newContactId, e });
  }

  return { ok: true, newContactId, assignedToSpaceId: providerSpace.id };
}
