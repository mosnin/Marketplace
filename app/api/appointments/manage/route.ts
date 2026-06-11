import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * POST — Guest self-service appointment management via manage token.
 * Actions: cancel
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed } = await checkRateLimit(`appointment-manage:${ip}`, 10, 3600);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { token, action } = await req.json();

  if (!token || !action) {
    return NextResponse.json({ error: 'token and action required' }, { status: 400 });
  }

  const { data: appointment } = await supabase
    .from('Appointment')
    .select('id, status, startsAt')
    .eq('manageToken', token)
    .maybeSingle();

  if (!appointment) {
    return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
  }

  if (action === 'cancel') {
    if (appointment.status === 'cancelled') {
      return NextResponse.json({ error: 'Already cancelled' }, { status: 400 });
    }
    if (appointment.status === 'completed') {
      return NextResponse.json({ error: 'Cannot cancel a completed appointment' }, { status: 400 });
    }
    if (appointment.status === 'no_show') {
      return NextResponse.json({ error: 'Cannot cancel a no-show appointment' }, { status: 400 });
    }
    // Don't allow cancellation within 1 hour of appointment
    const hourBefore = new Date(new Date(appointment.startsAt).getTime() - 60 * 60 * 1000);
    if (new Date() > hourBefore) {
      return NextResponse.json(
        { error: 'Cannot cancel within 1 hour of the appointment. Please contact the agent directly.' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('Appointment')
      .update({ status: 'cancelled', updatedAt: new Date().toISOString() })
      .eq('id', appointment.id);

    if (error) throw error;
    return NextResponse.json({ success: true, status: 'cancelled' });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
