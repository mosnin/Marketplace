import { NextResponse } from 'next/server';
import { requireAgency } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/agency/notifications
 * Returns the latest agency notifications.
 */
export async function GET() {
  let ctx;
  try {
    ctx = await requireAgency();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: notifications } = await supabase
    .from('AgencyNotification')
    .select('*')
    .eq('agencyId', ctx.agency.id)
    .order('createdAt', { ascending: false })
    .limit(20);

  return NextResponse.json({ notifications: notifications ?? [] });
}

/**
 * PATCH /api/agency/notifications
 * Mark all unread notifications as read.
 */
export async function PATCH() {
  let ctx;
  try {
    ctx = await requireAgency();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await supabase
    .from('AgencyNotification')
    .update({ read: true })
    .eq('agencyId', ctx.agency.id)
    .eq('read', false);

  return NextResponse.json({ success: true });
}
