import { NextResponse } from 'next/server';
import { requireAgency } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';

type Params = { params: Promise<{ userId: string }> };

/**
 * GET /api/agency/providers/[userId]
 * Returns a provider's contacts, deals, and stats for the agency drill-down view.
 * Only returns data if the user is a member of the agency's agency.
 */
export async function GET(_req: Request, { params }: Params) {
  let ctx;
  try {
    ctx = await requireAgency();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await params;

  // Verify this user is a member of the agency's agency
  const { data: membership } = await supabase
    .from('AgencyMembership')
    .select('id, role, createdAt')
    .eq('agencyId', ctx.agency.id)
    .eq('userId', userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: 'Member not found in this agency' }, { status: 404 });
  }

  // Get user + space
  const { data: user } = await supabase
    .from('User')
    .select('id, name, email, onboard')
    .eq('id', userId)
    .maybeSingle();
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const { data: space } = await supabase
    .from('Space')
    .select('id, slug, name')
    .eq('ownerId', userId)
    .maybeSingle();

  if (!space) {
    return NextResponse.json({
      user,
      membership,
      space: null,
      contacts: [],
      deals: [],
      stages: [],
    });
  }

  // Get recent contacts (last 50)
  const { data: contacts } = await supabase
    .from('Contact')
    .select('id, name, email, phone, type, tags, leadScore, scoreLabel, followUpAt, createdAt')
    .eq('spaceId', space.id)
    .order('createdAt', { ascending: false })
    .limit(50);

  // Get deals with stages
  const { data: deals } = await supabase
    .from('Deal')
    .select('id, title, value, status, stageId, closeDate, createdAt')
    .eq('spaceId', space.id)
    .order('createdAt', { ascending: false })
    .limit(50);

  const { data: stages } = await supabase
    .from('DealStage')
    .select('id, name, color, position')
    .eq('spaceId', space.id)
    .order('position', { ascending: true });

  return NextResponse.json({
    user,
    membership,
    space,
    contacts: contacts ?? [],
    deals: deals ?? [],
    stages: stages ?? [],
  });
}
