import { NextRequest, NextResponse } from 'next/server';
import { requireAgency } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { z } from 'zod';

const addNoteSchema = z.object({
  contactId: z.string().uuid('Invalid contact ID'),
  note: z.string().min(1, 'Note cannot be empty').max(2000, 'Note too long'),
});

/**
 * POST /api/agency/lead-note
 *
 * Appends a agency note to a contact's notes field.
 * The note is prefixed with "[Agency: Name - Date]" so providers can see who wrote it.
 * Works on contacts in both the agency's space (unassigned) and provider spaces (assigned).
 */
export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireAgency();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { agency, dbUserId } = ctx;

  let requestBody: unknown;
  try {
    requestBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = addNoteSchema.safeParse(requestBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request data', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { contactId, note } = parsed.data;

  try {
    // Get agency user's name
    const { data: agencyUser } = await supabase
      .from('User')
      .select('name, email')
      .eq('id', dbUserId)
      .maybeSingle();
    const agencyName = agencyUser?.name ?? agencyUser?.email ?? 'Agency';

    // Find the agency's space
    const { data: ownerSpace } = await supabase
      .from('Space')
      .select('id')
      .eq('ownerId', agency.ownerId)
      .maybeSingle();
    const agencySpaceId = ownerSpace?.id ?? null;

    // First check: is this contact in the agency's own space?
    const { data: contact } = await supabase
      .from('Contact')
      .select('id, notes, spaceId, applicationStatusNote')
      .eq('id', contactId)
      .maybeSingle();

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // Verify the contact belongs to agency space or a provider in this agency
    let authorized = false;

    if (contact.spaceId === agencySpaceId) {
      authorized = true;
    } else {
      // Check if the contact's space belongs to a agency member
      const { data: spaceOwner } = await supabase
        .from('Space')
        .select('ownerId')
        .eq('id', contact.spaceId)
        .maybeSingle();

      if (spaceOwner) {
        const { data: membership } = await supabase
          .from('AgencyMembership')
          .select('id')
          .eq('agencyId', agency.id)
          .eq('userId', spaceOwner.ownerId)
          .maybeSingle();
        if (membership) authorized = true;
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Not authorized to add notes to this contact' }, { status: 403 });
    }

    // Build the note prefix
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const prefix = `[Agency: ${agencyName} - ${dateStr}]`;
    const newNote = `${prefix} ${note}`;

    // Prepend to existing notes (newest first)
    const existingNotes = contact.notes ?? '';
    const updatedNotes = existingNotes
      ? `${newNote}\n\n${existingNotes}`
      : newNote;

    const { error: updateError } = await supabase
      .from('Contact')
      .update({
        notes: updatedNotes,
        updatedAt: now.toISOString(),
      })
      .eq('id', contactId);

    if (updateError) throw updateError;

    // If this is an assigned lead, also add the note to the provider's copy
    if (contact.spaceId === agencySpaceId && contact.applicationStatusNote) {
      try {
        const meta = JSON.parse(contact.applicationStatusNote);
        if (meta.assignedContactId) {
          const { data: providerContact } = await supabase
            .from('Contact')
            .select('id, notes')
            .eq('id', meta.assignedContactId)
            .maybeSingle();

          if (providerContact) {
            const providerExisting = providerContact.notes ?? '';
            const providerUpdated = providerExisting
              ? `${newNote}\n\n${providerExisting}`
              : newNote;

            await supabase
              .from('Contact')
              .update({
                notes: providerUpdated,
                updatedAt: now.toISOString(),
              })
              .eq('id', meta.assignedContactId);
          }
        }
      } catch {
        // If parsing fails, skip syncing to provider copy
      }
    }

    return NextResponse.json({
      success: true,
      note: newNote,
      updatedNotes,
    });
  } catch (error) {
    console.error('[lead-note] error', { contactId, error });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

/**
 * GET /api/agency/lead-note?contactId=xxx
 *
 * Returns the notes for a contact (agency must have access).
 */
export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireAgency();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { agency } = ctx;

  const contactId = req.nextUrl.searchParams.get('contactId');
  if (!contactId) {
    return NextResponse.json({ error: 'contactId required' }, { status: 400 });
  }

  try {
    const { data: contact } = await supabase
      .from('Contact')
      .select('id, notes, spaceId')
      .eq('id', contactId)
      .maybeSingle();

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // Verify the contact belongs to the agency's space or a agency member's space
    const { data: ownerSpace } = await supabase
      .from('Space')
      .select('id')
      .eq('ownerId', agency.ownerId)
      .maybeSingle();
    const agencySpaceId = ownerSpace?.id ?? null;

    let authorized = false;

    if (contact.spaceId === agencySpaceId) {
      authorized = true;
    } else {
      // Check if the contact's space belongs to a agency member
      const { data: spaceOwner } = await supabase
        .from('Space')
        .select('ownerId')
        .eq('id', contact.spaceId)
        .maybeSingle();

      if (spaceOwner) {
        const { data: membership } = await supabase
          .from('AgencyMembership')
          .select('id')
          .eq('agencyId', agency.id)
          .eq('userId', spaceOwner.ownerId)
          .maybeSingle();
        if (membership) authorized = true;
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Not authorized to view notes for this contact' }, { status: 403 });
    }

    return NextResponse.json({ notes: contact.notes ?? '' });
  } catch (error) {
    console.error('[lead-note] GET error', { contactId, error });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
