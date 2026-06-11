import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireSpaceOwner } from '@/lib/api-auth';

/**
 * Convert a completed appointment into a deal.
 * Pre-fills the deal with guest info and service address,
 * links the contact, and records the sourceAppointmentId.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { slug, appointmentId } = body;

  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
  if (!appointmentId) return NextResponse.json({ error: 'appointmentId required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  // Fetch the appointment
  const { data: appointment, error: appointmentError } = await supabase
    .from('Appointment')
    .select('*')
    .eq('id', appointmentId)
    .eq('spaceId', space.id)
    .maybeSingle();
  if (appointmentError) throw appointmentError;
  if (!appointment) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });

  // Check if already converted
  const { data: existingDeal } = await supabase
    .from('Deal')
    .select('id')
    .eq('sourceAppointmentId', appointmentId)
    .maybeSingle();
  if (existingDeal) {
    return NextResponse.json({ error: 'Appointment already converted to a deal', dealId: existingDeal.id }, { status: 409 });
  }

  // Get the first deal stage for this space (used as default)
  const { data: firstStage } = await supabase
    .from('DealStage')
    .select('id')
    .eq('spaceId', space.id)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstStage) {
    return NextResponse.json({ error: 'No deal stages configured. Create a deal stage first.' }, { status: 400 });
  }

  // Create or find linked contact
  let contactId = appointment.contactId;
  if (!contactId) {
    // Try to find by email
    const { data: contactRow } = await supabase
      .from('Contact')
      .select('id')
      .eq('spaceId', space.id)
      .ilike('email', appointment.guestEmail)
      .maybeSingle();

    if (contactRow) {
      contactId = contactRow.id;
    } else {
      // Create a new contact
      const newContactId = crypto.randomUUID();
      const { error: contactErr } = await supabase.from('Contact').insert({
        id: newContactId,
        spaceId: space.id,
        name: appointment.guestName,
        email: appointment.guestEmail,
        phone: appointment.guestPhone || null,
        type: 'APPOINTMENT',
        tags: ['from-appointment'],
        // 'unscored' violates contact_scoring_status_check (pending|scored|failed);
        // it silently failed the insert so the deal was created with no contact link.
        scoringStatus: 'pending',
      });
      if (!contactErr) contactId = newContactId;
    }
  }

  // Determine the next position in the first stage
  const { data: maxPositionRow } = await supabase
    .from('Deal')
    .select('position')
    .eq('stageId', firstStage.id)
    .eq('spaceId', space.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = maxPositionRow ? maxPositionRow.position + 1 : 0;

  // Create the deal
  const dealId = crypto.randomUUID();
  const { data: deal, error: dealError } = await supabase
    .from('Deal')
    .insert({
      id: dealId,
      spaceId: space.id,
      title: appointment.serviceAddress
        ? `${appointment.guestName} — ${appointment.serviceAddress}`
        : `${appointment.guestName} — Appointment Follow-up`,
      address: appointment.serviceAddress || null,
      description: `Converted from appointment on ${new Date(appointment.startsAt).toLocaleDateString()}${appointment.notes ? `\n\nAppointment notes: ${appointment.notes}` : ''}`,
      stageId: firstStage.id,
      status: 'active',
      priority: 'MEDIUM',
      position: nextPosition,
      milestones: [],
      sourceAppointmentId: appointmentId,
    })
    .select()
    .single();
  if (dealError) throw dealError;

  // Link contact to deal
  if (contactId) {
    const { error: dcError } = await supabase.from('DealContact').insert({ dealId, contactId });
    if (dcError) console.error('[convert] DealContact link failed:', dcError);
    // Update appointment with contact link if it wasn't set
    if (!appointment.contactId) {
      await supabase.from('Appointment').update({ contactId }).eq('id', appointmentId);
    }
  }

  return NextResponse.json({ deal, contactId }, { status: 201 });
}
