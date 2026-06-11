/**
 * `add_service` — insert a Service row.
 *
 * Approval-gated: a new listing shows up on the service index immediately.
 * The provider confirms the address (and any optional details) before we
 * create the row.
 *
 * Mirrors the Python `add_service` in `agent/tools/services.py`. We keep
 * the field set narrow — the provider can fill the rest in the service page
 * after creation. Validation matches the DB CHECK constraints from
 * migration 20260425000000_service.sql.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { defineTool } from '../types';

const SERVICE_TYPES = [
  'single_family',
  'condo',
  'townhouse',
  'multi_family',
  'land',
  'commercial',
  'other',
] as const;

const LISTING_STATUSES = ['active', 'pending', 'sold', 'off_market', 'owned'] as const;

const parameters = z
  .object({
    address: z.string().trim().min(1).max(500).describe('Street address line.'),
    listingStatus: z
      .enum(LISTING_STATUSES)
      .optional()
      .describe("Listing status. Defaults to 'active'."),
    listPrice: z
      .number()
      .nonnegative()
      .max(1_000_000_000)
      .optional()
      .describe('List price in dollars (no currency symbols).'),
    serviceType: z.enum(SERVICE_TYPES).optional().describe('Service type.'),
    beds: z.number().nonnegative().max(99).optional(),
    baths: z.number().nonnegative().max(99).optional(),
    squareFeet: z.number().int().nonnegative().max(1_000_000).optional(),
    mlsNumber: z.string().trim().max(64).optional(),
    listingUrl: z.string().trim().url().max(2000).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .describe('Add a service to the workspace.');

interface AddServiceResult {
  serviceId: string;
  address: string;
  listingStatus: string;
}

export const addServiceTool = defineTool<typeof parameters, AddServiceResult>({
  name: 'add_service',
  riskLevel: 'low',
  description:
    'Add a new service to the workspace. Captures address plus optional list price, beds/baths, MLS number. Prompts for approval first.',
  parameters,
  requiresApproval: true,
  rateLimit: { max: 30, windowSeconds: 3600 },
  summariseCall(args) {
    const addr = args?.address?.trim() || 'new address';
    return `Add service at ${addr}`;
  },

  async handler(args, ctx) {
    const serviceId = crypto.randomUUID();
    const status = args.listingStatus ?? 'active';
    const row = {
      id: serviceId,
      spaceId: ctx.space.id,
      address: args.address.trim(),
      listingStatus: status,
      listPrice: args.listPrice ?? null,
      serviceType: args.serviceType ?? null,
      beds: args.beds ?? null,
      baths: args.baths ?? null,
      squareFeet: args.squareFeet ?? null,
      mlsNumber: args.mlsNumber?.trim() || null,
      listingUrl: args.listingUrl?.trim() || null,
      notes: args.notes?.trim() || null,
    };

    const { error: insertErr } = await supabase.from('Service').insert(row);
    if (insertErr) {
      logger.error('[tools.add_service] insert failed', { address: row.address }, insertErr);
      return { summary: `Couldn't add the service: ${insertErr.message}`, display: 'error' };
    }

    return {
      summary: `Service added at ${row.address}.`,
      data: { serviceId, address: row.address, listingStatus: status },
      display: 'success',
    };
  },
});
