/**
 * `update_service_status` — flip a Service's listing status.
 *
 * Approval-gated: the listing status drives the service card label and
 * filters across the service index — a wrong flip ("sold" instead of
 * "pending") is visible immediately to the provider and to anyone with
 * a share link.
 *
 * Allowed statuses come from the DB CHECK constraint on
 * Service.listingStatus (see migration 20260425000000_service.sql):
 *   active | pending | sold | off_market | owned
 */

import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { defineTool } from '../types';

const ALLOWED = ['active', 'pending', 'sold', 'off_market', 'owned'] as const;

const parameters = z
  .object({
    serviceId: z.string().min(1).describe('The Service.id to update.'),
    newStatus: z.enum(ALLOWED).describe('New listing status.'),
    why: z.string().max(500).optional(),
  })
  .describe("Update a service's listing status.");

interface UpdateServiceStatusResult {
  serviceId: string;
  oldStatus: string;
  newStatus: string;
}

export const updateServiceStatusTool = defineTool<typeof parameters, UpdateServiceStatusResult>({
  name: 'update_service_status',
  riskLevel: 'low',
  description:
    "Update a service's listing status (active, pending, sold, off_market, owned). Prompts for approval first.",
  parameters,
  requiresApproval: true,
  rateLimit: { max: 60, windowSeconds: 3600 },
  summariseCall(args) {
    const why = args.why ? ` — ${args.why}` : '';
    return `Set service ${args.serviceId.slice(0, 8)} → ${args.newStatus}${why}`;
  },

  async handler(args, ctx) {
    const { data: service, error: fetchErr } = await supabase
      .from('Service')
      .select('id, address, listingStatus')
      .eq('id', args.serviceId)
      .eq('spaceId', ctx.space.id)
      .maybeSingle();
    if (fetchErr) {
      return { summary: `Service lookup failed: ${fetchErr.message}`, display: 'error' };
    }
    if (!service) {
      return { summary: `No service with id "${args.serviceId}".`, display: 'error' };
    }

    const oldStatus = (service.listingStatus as string) || 'active';
    if (oldStatus === args.newStatus) {
      return {
        summary: `${service.address} is already ${args.newStatus}.`,
        data: { serviceId: service.id, oldStatus, newStatus: args.newStatus },
        display: 'plain',
      };
    }

    const { error: updateErr } = await supabase
      .from('Service')
      .update({ listingStatus: args.newStatus, updatedAt: new Date().toISOString() })
      .eq('id', args.serviceId)
      .eq('spaceId', ctx.space.id);
    if (updateErr) {
      logger.error('[tools.update_service_status] update failed', { serviceId: args.serviceId }, updateErr);
      return { summary: `Update failed: ${updateErr.message}`, display: 'error' };
    }

    return {
      summary: `${service.address} → ${args.newStatus}.`,
      data: { serviceId: service.id, oldStatus, newStatus: args.newStatus },
      display: 'success',
    };
  },
});
