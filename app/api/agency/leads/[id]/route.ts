import { NextRequest, NextResponse } from 'next/server';
import { requireAgency, canManageLeads } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { getSpaceByOwnerId } from '@/lib/space';
import { deleteContactVector } from '@/lib/vectorize';
import { deleteObjectsBestEffort } from '@/lib/storage';
import { logger } from '@/lib/logger';

/**
 * DELETE /api/agency/leads/[id]
 *
 * Deletes an unassigned agency-intake lead. Unlike /api/contacts/[id]
 * (which scopes the delete to the CALLER'S OWN space), agency intake leads
 * live in the agency OWNER's space — so a agency_admin (a different user with a
 * different personal space) can never match that scope and gets a spurious 404.
 *
 * This endpoint authorizes against the AGENCY (any in-agency owner/admin),
 * mirroring /api/agency/lead-note and /api/agency/unassign-lead, and identifies
 * the lead the same way unassign-lead does: it lives in the agency owner's space
 * OR carries this agency's agencyId. The delete is scoped to whichever the
 * lead actually matched — never the caller's personal space.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Auth: require agency_owner or agency_admin ───────────────────────────
  let ctx;
  try {
    ctx = await requireAgency();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Role check: only agency_owner and agency_admin can manage leads ──────
  if (!canManageLeads(ctx.membership.role)) {
    return NextResponse.json(
      { error: 'Only the owner or admins can delete leads' },
      { status: 403 },
    );
  }

  const { agency } = ctx;
  const { id } = await params;

  try {
    // ── Find the agency owner's space (where intake leads live) ──────────
    const agencySpace = await getSpaceByOwnerId(agency.ownerId);
    if (!agencySpace) {
      return NextResponse.json(
        { error: 'Agency space not found' },
        { status: 500 },
      );
    }

    // ── Identify the lead exactly the way unassign-lead does ─────────────
    // First in the agency owner's space, then by agencyId. The lead must
    // match one of these to belong to THIS agency.
    const { data: spaceContact, error: spaceContactError } = await supabase
      .from('Contact')
      .select('*')
      .eq('id', id)
      .eq('spaceId', agencySpace.id)
      .maybeSingle();
    if (spaceContactError) throw spaceContactError;

    let contact = spaceContact;
    // Track which predicate the lead actually matched so the DELETE below is
    // scoped to the same binding — never widened, never the caller's space.
    let deleteScope: { column: 'spaceId' | 'agencyId'; value: string } = {
      column: 'spaceId',
      value: agencySpace.id,
    };

    if (!contact) {
      const { data: agencyContact, error: agencyContactError } = await supabase
        .from('Contact')
        .select('*')
        .eq('id', id)
        .eq('agencyId', agency.id)
        .maybeSingle();
      if (agencyContactError) throw agencyContactError;
      contact = agencyContact;
      deleteScope = { column: 'agencyId', value: agency.id };
    }

    if (!contact) {
      return NextResponse.json(
        { error: 'Lead not found in your agency' },
        { status: 404 },
      );
    }

    // ── Capture document storage keys BEFORE deleting the Contact ────────
    // The FK cascade removes ContactDocument rows the moment the Contact is
    // gone; Wasabi objects don't cascade, so grab the keys now or orphan PII.
    const { data: docRows } = await supabase
      .from('ContactDocument')
      .select('storageKey')
      .eq('contactId', id);
    const docKeys = (docRows ?? [])
      .map((r) => (r as { storageKey: string }).storageKey)
      .filter((k): k is string => Boolean(k));

    // ── Clean up DealContact links + orphan deals, scoped to this contact ──
    const { data: dealContactLinks } = await supabase
      .from('DealContact')
      .select('dealId')
      .eq('contactId', id);

    if (dealContactLinks && dealContactLinks.length > 0) {
      const dealIds = dealContactLinks.map((dc: { dealId: string }) => dc.dealId);

      await supabase.from('DealContact').delete().eq('contactId', id);

      // Orphan-deal sweep — drop only deals in the agency owner's space that
      // have no remaining contact links.
      for (const dealId of dealIds) {
        const { data: remainingLinks } = await supabase
          .from('DealContact')
          .select('id')
          .eq('dealId', dealId)
          .limit(1);

        if (!remainingLinks || remainingLinks.length === 0) {
          await supabase
            .from('Deal')
            .delete()
            .eq('id', dealId)
            .eq('spaceId', agencySpace.id);
        }
      }
    }

    // ── Delete the lead, scoped to the binding it actually matched ───────
    const { error: deleteError } = await supabase
      .from('Contact')
      .delete()
      .eq('id', id)
      .eq(deleteScope.column, deleteScope.value);
    if (deleteError) {
      console.error('[agency/leads/DELETE] delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete lead' }, { status: 500 });
    }

    // Fire-and-forget the Wasabi cleanup — the row's already gone.
    if (docKeys.length > 0) {
      void deleteObjectsBestEffort(docKeys).then((res) => {
        if (res.failed.length > 0) {
          logger.warn('[agency/leads/DELETE] some doc objects failed to delete', {
            contactId: id,
            okCount: res.ok,
            failedCount: res.failed.length,
          });
        }
      });
    }

    deleteContactVector(contact.spaceId, id).catch(console.error);

    console.info('[agency/leads/DELETE] lead deleted', {
      contactId: id,
      agencyId: agency.id,
      deletedBy: ctx.dbUserId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[agency/leads/DELETE] unhandled error', {
      contactId: id,
      agencyId: agency.id,
      error,
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
