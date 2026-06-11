import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { getAgencyMemberContext } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';

// ── Shared types / schema ─────────────────────────────────────────────────────
//
// These shapes mirror the `AgencyTemplate` table introduced in Phase BP6a.
// Columns live in the DB as-is (versioned rows, not JSON blobs) so the row
// type is just the table row.

type TemplateCategory = 'follow-up' | 'intro' | 'closing' | 'appointment-invite';
type TemplateChannel = 'sms' | 'email' | 'note';

type AgencyTemplateRow = {
  id: string;
  agencyId: string;
  name: string;
  category: TemplateCategory;
  channel: TemplateChannel;
  subject: string | null;
  body: string;
  version: number;
  publishedAt: string | null;
  publishedVersion: number | null;
  publishedCount: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

const TEMPLATE_COLUMNS =
  'id, agencyId, name, category, channel, subject, body, version, publishedAt, publishedVersion, publishedCount, createdByUserId, createdAt, updatedAt';

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.enum(['follow-up', 'intro', 'closing', 'appointment-invite']),
  channel: z.enum(['sms', 'email', 'note']),
  subject: z
    .union([z.string().max(200), z.null()])
    .optional(),
  body: z.string().min(1).max(5000),
});

// ── GET — any agency member may read their agency's templates ──────────────

/**
 * GET /api/agency/templates
 *
 * Returns the agency's template library ordered by updatedAt DESC.
 * All agency-scoped members (owner, admin, provider) can read — viewing the
 * library is a prerequisite for agents to pull published copies.
 */
export async function GET(): Promise<NextResponse> {
  const ctx = await getAgencyMemberContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('AgencyTemplate')
    .select(TEMPLATE_COLUMNS)
    .eq('agencyId', ctx.agency.id)
    .order('updatedAt', { ascending: false });

  if (error) {
    logger.error(
      '[agency/templates/GET] list failed',
      { agencyId: ctx.agency.id },
      error,
    );
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }

  return NextResponse.json((data ?? []) as AgencyTemplateRow[]);
}

// ── POST — create a new template (agency_owner / agency_admin only) ───────────

/**
 * POST /api/agency/templates
 *
 * Body: { name, category, channel, subject?, body }
 * Restricted to agency_owner / agency_admin. Provider members may read the
 * library but cannot author it.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId: clerkId } = await auth();

  const ctx = await getAgencyMemberContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (ctx.membership.role !== 'agency_owner' && ctx.membership.role !== 'agency_admin') {
    return NextResponse.json(
      { error: 'Only the owner or admins can create templates' },
      { status: 403 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid data', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Normalise: non-email channels never carry a subject; for email we store
  // the provided subject (or null if absent/empty). Keeps data tidy and stops
  // stray subject text from leaking onto SMS/note renders.
  const { name, category, channel, body } = parsed.data;
  const subject =
    channel === 'email'
      ? (parsed.data.subject ?? null) || null
      : null;

  const { data: inserted, error: insertErr } = await supabase
    .from('AgencyTemplate')
    .insert({
      agencyId: ctx.agency.id,
      name,
      category,
      channel,
      subject,
      body,
      version: 1,
      publishedAt: null,
      publishedCount: 0,
      createdByUserId: ctx.dbUserId,
    })
    .select(TEMPLATE_COLUMNS)
    .single<AgencyTemplateRow>();

  if (insertErr || !inserted) {
    logger.error(
      '[agency/templates/POST] insert failed',
      { agencyId: ctx.agency.id },
      insertErr,
    );
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  }

  void audit({
    actorClerkId: clerkId ?? null,
    action: 'CREATE',
    resource: 'AgencyTemplate',
    resourceId: inserted.id,
    req,
    metadata: {
      agencyId: ctx.agency.id,
      name: inserted.name,
      category: inserted.category,
      channel: inserted.channel,
    },
  });

  return NextResponse.json(inserted, { status: 201 });
}
