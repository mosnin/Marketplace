import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireSpaceOwner } from '@/lib/api-auth';

/** GET — list overrides for the next 90 days */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  const serviceId = req.nextUrl.searchParams.get('serviceId');
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  let query = supabase
    .from('AppointmentAvailabilityOverride')
    .select('*')
    .eq('spaceId', space.id)
    .order('date', { ascending: true });

  // Filter by service or show global-only
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (serviceId) {
    if (!UUID_RE.test(serviceId)) {
      return NextResponse.json({ error: 'Invalid serviceId' }, { status: 400 });
    }
    query = query.or(`serviceProfileId.eq.${serviceId},serviceProfileId.is.null`);
  } else {
    query = query.is('serviceProfileId', null);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Filter out past non-recurring overrides
  const today = new Date().toISOString().split('T')[0];
  const filtered = (data ?? []).filter((o: any) => {
    if (o.recurrence !== 'none') {
      // Keep recurring overrides if endDate is in the future or not set
      return !o.endDate || o.endDate >= today;
    }
    return o.date >= today;
  });

  return NextResponse.json(filtered);
}

/** POST — create or update an override */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { slug, date, isBlocked, startHour, endHour, label, recurrence, endDate, serviceProfileId } = body;

  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date format (YYYY-MM-DD)' }, { status: 400 });
  }

  const validRecurrences = ['none', 'weekly', 'biweekly', 'monthly'];
  const rec = recurrence && validRecurrences.includes(recurrence) ? recurrence : 'none';

  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json({ error: 'Invalid endDate format' }, { status: 400 });
  }

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  // Check for an existing override on this date+service combination and delete it first
  // (handles NULL serviceProfileId case where upsert uniqueness may not work)
  {
    let existingQuery = supabase
      .from('AppointmentAvailabilityOverride')
      .select('id')
      .eq('spaceId', space.id)
      .eq('date', date);
    if (serviceProfileId) {
      existingQuery = existingQuery.eq('serviceProfileId', serviceProfileId);
    } else {
      existingQuery = existingQuery.is('serviceProfileId', null);
    }
    const { data: existingRows } = await existingQuery;
    if (existingRows && existingRows.length > 0) {
      const ids = existingRows.map((r: { id: string }) => r.id);
      await supabase.from('AppointmentAvailabilityOverride').delete().in('id', ids);
    }
  }

  if (!isBlocked) {
    if (startHour == null || endHour == null) {
      return NextResponse.json({ error: 'startHour and endHour required when not blocked' }, { status: 400 });
    }
    if (startHour < 0 || startHour > 23 || endHour < 1 || endHour > 24 || endHour <= startHour) {
      return NextResponse.json({ error: 'Invalid hour range' }, { status: 400 });
    }
  }

  // Validate service profile if provided
  if (serviceProfileId) {
    const { data: profile } = await supabase
      .from('AppointmentServiceProfile')
      .select('id')
      .eq('id', serviceProfileId)
      .eq('spaceId', space.id)
      .maybeSingle();
    if (!profile) return NextResponse.json({ error: 'Service profile not found' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('AppointmentAvailabilityOverride')
    .insert({
      id: crypto.randomUUID(),
      spaceId: space.id,
      serviceProfileId: serviceProfileId || null,
      date,
      isBlocked: !!isBlocked,
      startHour: isBlocked ? null : startHour,
      endHour: isBlocked ? null : endHour,
      label: label?.trim() || null,
      recurrence: rec,
      endDate: rec !== 'none' ? (endDate || null) : null,
    })
    .select()
    .single();
  if (error) throw error;

  return NextResponse.json(data, { status: 201 });
}
