import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * POST /api/applications/portal/appointment/[appointmentId]/respond
 *
 * Public endpoint — applicant confirms or declines a appointment from the portal.
 * Auth pattern matches /api/applications/portal/message and appointment-request:
 * applicationRef + statusPortalToken on the Contact, plus the appointment must be
 * linked to that same contact.
 *
 * On success:
 *   - Appointment.status flipped to 'confirmed' (action='confirm') or 'cancelled'
 *     (action='decline')
 *   - ApplicationMessage row added so the provider sees the response in the
 *     existing thread + so the applicant has receipt in their own thread
 *
 * Idempotent: confirming an already-confirmed appointment is a no-op success.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ appointmentId: string }> },
) {
  const { appointmentId } = await ctx.params;
  if (!appointmentId || typeof appointmentId !== 'string' || appointmentId.length > 64) {
    return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
  }

  let body: {
    applicationRef?: string;
    token?: string;
    action?: 'confirm' | 'decline';
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { applicationRef, token, action, notes } = body;

  if (!applicationRef || !token || !action) {
    return NextResponse.json(
      { error: 'applicationRef, token, and action are required' },
      { status: 400 },
    );
  }
  if (action !== 'confirm' && action !== 'decline') {
    return NextResponse.json(
      { error: "action must be 'confirm' or 'decline'" },
      { status: 400 },
    );
  }
  if (
    typeof applicationRef !== 'string' || applicationRef.length < 10 || applicationRef.length > 64 ||
    typeof token !== 'string' || token.length < 32 || token.length > 128
  ) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }

  // Rate limit — applicants don't normally respond to appointments dozens of times
  const ip = getClientIp(req);
  const { allowed: ipAllowed } = await checkRateLimit(`portal:appointment-respond:ip:${ip}`, 30, 3600);
  if (!ipAllowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again in a bit.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    );
  }

  // Verify token + application
  const { data: contact, error: contactError } = await supabase
    .from('Contact')
    .select('id, spaceId, name')
    .eq('applicationRef', applicationRef)
    .eq('statusPortalToken', token)
    .maybeSingle();

  if (contactError) {
    console.error('[portal/appointment-respond] Contact lookup error:', contactError);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
  if (!contact) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }

  // Validate appointment belongs to this contact + space (defense in depth)
  const { data: appointment, error: appointmentError } = await supabase
    .from('Appointment')
    .select('id, spaceId, contactId, status, startsAt, serviceAddress')
    .eq('id', appointmentId)
    .maybeSingle();

  if (appointmentError) {
    console.error('[portal/appointment-respond] Appointment lookup error:', appointmentError);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
  if (!appointment || appointment.contactId !== contact.id || appointment.spaceId !== contact.spaceId) {
    return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
  }

  // Idempotent — confirming already-confirmed is a successful no-op.
  // Cancelling an already-cancelled is the same. Don't post duplicate messages.
  const targetStatus = action === 'confirm' ? 'confirmed' : 'cancelled';
  if (appointment.status === targetStatus) {
    return NextResponse.json({ ok: true, appointment: { id: appointment.id, status: appointment.status } });
  }

  // Reject illogical transitions — e.g. don't let an applicant confirm a
  // appointment that's already been completed or cancelled by the provider.
  if (appointment.status === 'completed' || appointment.status === 'no_show') {
    return NextResponse.json(
      { error: 'This appointment is closed and can no longer be changed.' },
      { status: 409 },
    );
  }
  if (appointment.status === 'cancelled' && action === 'confirm') {
    return NextResponse.json(
      { error: 'This appointment was cancelled. Ask your provider to reschedule.' },
      { status: 409 },
    );
  }

  // Compare-and-swap on the appointment status: only update if it's still in the
  // status we read above. Two parallel calls (network glitch + applicant
  // double-click) without CAS would both pass the L107 idempotency check
  // (status was 'scheduled' for both), both run an unguarded UPDATE, and
  // both insert their receipt message — cluttering the provider's thread
  // with duplicates. With CAS, only the first writer's UPDATE returns a
  // row; the second sees zero affected rows and skips the message insert.
  const { data: updated, error: updateError } = await supabase
    .from('Appointment')
    .update({ status: targetStatus, updatedAt: new Date().toISOString() })
    .eq('id', appointmentId)
    .eq('spaceId', contact.spaceId)
    .eq('status', appointment.status)
    .select('id');
  if (updateError) {
    console.error('[portal/appointment-respond] Appointment update error:', updateError);
    return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 });
  }

  // Lost the CAS — another concurrent caller already moved the appointment.
  // Return a clean success without inserting a duplicate message; the
  // first writer's message is already on the thread.
  if (!updated || updated.length === 0) {
    return NextResponse.json({
      ok: true,
      appointment: { id: appointment.id, status: targetStatus },
    });
  }

  // Compose receipt message for the thread.
  const sanitize = (s: string) =>
    s
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/[^\w\s.,!?;:'"@#$%&*()\-/+=\[\]{}~`^\n\r\t]/g, '');
  const safeNotes = sanitize((notes ?? '').trim()).slice(0, 1000);
  const appointmentTime = new Date(appointment.startsAt).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const propLine = appointment.serviceAddress ? ` at ${sanitize(appointment.serviceAddress).slice(0, 200)}` : '';
  const messageBody =
    action === 'confirm'
      ? `✓ Confirmed appointment ${appointmentTime}${propLine}.${safeNotes ? `\n\n${safeNotes}` : ''}`
      : `✗ Can't make appointment ${appointmentTime}${propLine}.${safeNotes ? `\n\n${safeNotes}` : ''}`;

  await supabase
    .from('ApplicationMessage')
    .insert({
      contactId: contact.id,
      spaceId: contact.spaceId,
      senderType: 'applicant',
      content: messageBody,
    });

  return NextResponse.json({
    ok: true,
    appointment: { id: appointment.id, status: targetStatus },
  });
}
