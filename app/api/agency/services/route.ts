import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { resolveAgencyContext } from '@/lib/agent/agency-context';
import { logger } from '@/lib/logger';
import { _sanitiseServiceBody as sanitiseBody } from '@/app/api/services/route';

/**
 * GET /api/agency/services — the agency's service pool.
 *
 * Lists every Service tagged with this agency (`agencyId`), newest
 * first, plus the roster of member spaces so the UI can render the
 * "assign to provider" control and resolve `assignedSpaceId` to a name.
 *
 * POST — create a pool service. It's owned by the agency owner's Space (so
 * the NOT NULL `spaceId` FK holds) and tagged with `agencyId`; an optional
 * `assignedSpaceId` assigns it to a member provider on creation.
 *
 * Agency-only gate: `resolveAgencyContext()` rejects provider_members.
 */

interface MemberSpace {
  id: string;
  name: string;
  ownerName: string | null;
}

/** The agency's member spaces (every provider's Space under the agency,
 *  plus the owner's own Space — the pool's home). Used to validate assignment
 *  targets and to label assigned services. */
async function loadMemberSpaces(agencyId: string, ownerId: string): Promise<MemberSpace[]> {
  const { data: spaces } = await supabase
    .from('Space')
    .select('id, name, ownerId')
    .or(`agencyId.eq.${agencyId},ownerId.eq.${ownerId}`)
    .limit(2000);
  const rows = (spaces ?? []) as { id: string; name: string; ownerId: string }[];
  if (rows.length === 0) return [];

  const ownerIds = Array.from(new Set(rows.map((r) => r.ownerId)));
  const { data: users } = await supabase.from('User').select('id, name').in('id', ownerIds);
  const nameById = new Map((users ?? []).map((u) => [u.id as string, u.name as string | null]));

  return rows.map((r) => ({ id: r.id, name: r.name, ownerName: nameById.get(r.ownerId) ?? null }));
}

export async function GET() {
  const ctx = await resolveAgencyContext();
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const members = await loadMemberSpaces(ctx.agency.id, ctx.agency.ownerId);

  const { data, error } = await supabase
    .from('Service')
    .select('*')
    .eq('agencyId', ctx.agency.id)
    .order('updatedAt', { ascending: false })
    .limit(2000);
  if (error) {
    logger.error('[agency/services/GET] query failed', { agencyId: ctx.agency.id }, error);
    return NextResponse.json({ error: 'Failed to fetch services' }, { status: 500 });
  }

  return NextResponse.json({ services: data ?? [], members });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveAgencyContext();
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  // The pool's home Space — the agency owner's. Required because Service.spaceId
  // is NOT NULL. A agency with no personal Space can't seed the pool yet.
  const { data: ownerSpace } = await supabase
    .from('Space')
    .select('id')
    .eq('ownerId', ctx.agency.ownerId)
    .maybeSingle();
  if (!ownerSpace?.id) {
    return NextResponse.json(
      { error: 'Set up your own workspace before adding pool services.' },
      { status: 409 },
    );
  }

  const { out, errors } = sanitiseBody(body, 'create');
  if (errors.length) return NextResponse.json({ error: errors.join(', ') }, { status: 400 });

  // Optional assignment on create — must be a space in this agency.
  let assignedSpaceId: string | null = null;
  if (typeof body.assignedSpaceId === 'string' && body.assignedSpaceId) {
    const members = await loadMemberSpaces(ctx.agency.id, ctx.agency.ownerId);
    if (!members.some((m) => m.id === body.assignedSpaceId)) {
      return NextResponse.json({ error: 'That provider is not in your agency.' }, { status: 400 });
    }
    assignedSpaceId = body.assignedSpaceId;
  }

  const insert = {
    id: crypto.randomUUID(),
    spaceId: ownerSpace.id as string,
    agencyId: ctx.agency.id,
    assignedSpaceId,
    listingStatus: out.listingStatus ?? 'active',
    photos: out.photos ?? [],
    ...out,
  };

  const { data, error } = await supabase.from('Service').insert(insert).select().single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'A service with that MLS number already exists' }, { status: 409 });
    }
    logger.error('[agency/services/POST] insert failed', { agencyId: ctx.agency.id }, error);
    return NextResponse.json({ error: 'Failed to create service' }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
