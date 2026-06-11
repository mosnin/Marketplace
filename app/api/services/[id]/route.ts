import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getSpaceForUser } from '@/lib/space';
import { requireAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { deleteObjectsBestEffort, publicUrlToKey } from '@/lib/storage';
import { _sanitiseServiceBody as sanitise } from '@/app/api/services/route';

async function resolve(userId: string, id: string) {
  const space = await getSpaceForUser(userId);
  if (!space) return null;
  const { data } = await supabase
    .from('Service')
    .select('*')
    .eq('id', id)
    .eq('spaceId', space.id)
    .maybeSingle();
  if (!data) return null;
  return { space, service: data };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await params;
  const ctx = await resolve(userId, id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Include linked deals + appointments so the detail page can show usage.
  const [dealsResult, appointmentsResult] = await Promise.all([
    supabase
      .from('Deal')
      .select('id, title, status, value, closeDate, stageId')
      .eq('serviceId', id)
      .eq('spaceId', ctx.space.id)
      .order('updatedAt', { ascending: false })
      .limit(20),
    supabase
      .from('Appointment')
      .select('id, guestName, startsAt, status')
      .eq('serviceId', id)
      .eq('spaceId', ctx.space.id)
      .order('startsAt', { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({
    ...ctx.service,
    deals: dealsResult.data ?? [],
    appointments: appointmentsResult.data ?? [],
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await params;
  const ctx = await resolve(userId, id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const { out, errors } = sanitise(body, 'update');
  if (errors.length) return NextResponse.json({ error: errors.join(', ') }, { status: 400 });
  if (Object.keys(out).length === 0) return NextResponse.json(ctx.service);

  const patch = { ...out, updatedAt: new Date().toISOString() };

  const { data, error } = await supabase
    .from('Service')
    .update(patch)
    .eq('id', id)
    .eq('spaceId', ctx.space.id)
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'A service with that MLS number already exists' }, { status: 409 });
    }
    logger.error('[services/PATCH] update failed', { serviceId: id }, error);
    return NextResponse.json({ error: 'Failed to update service' }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await params;
  const ctx = await resolve(userId, id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // `photos` is a JSONB array of public URLs (legacy schema decision).
  // Reverse each URL back to a Wasabi key so we can clean up the bucket
  // when the row is removed — otherwise listing photos for sold services
  // survive forever in storage, EXIF and all.
  const rawPhotos = (ctx.service as { photos?: unknown }).photos;
  const photoUrls = Array.isArray(rawPhotos)
    ? rawPhotos.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : [];
  const photoKeys = photoUrls
    .map((u) => publicUrlToKey(u))
    .filter((k): k is string => Boolean(k));

  // Linked deals/appointments get ON DELETE SET NULL'd — the link vanishes, the
  // deal/appointment survives with its string address intact.
  const { error } = await supabase
    .from('Service')
    .delete()
    .eq('id', id)
    .eq('spaceId', ctx.space.id);

  if (error) {
    logger.error('[services/DELETE] failed', { serviceId: id }, error);
    return NextResponse.json({ error: 'Failed to delete service' }, { status: 500 });
  }

  // Fire-and-forget the photo cleanup. Storage failure here orphans the
  // object; the nightly storage-gc sweeper catches it on its next pass.
  if (photoKeys.length > 0) {
    void deleteObjectsBestEffort(photoKeys).then((res) => {
      if (res.failed.length > 0) {
        logger.warn('[services/DELETE] some photos failed to delete', {
          serviceId: id,
          spaceId: ctx.space.id,
          okCount: res.ok,
          failedCount: res.failed.length,
        });
      }
    });
  }

  return NextResponse.json({ ok: true });
}
