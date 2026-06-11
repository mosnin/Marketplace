/**
 * `note_on_service` — append a dated note to Service.notes.
 *
 * Schema reality: Service has a single `notes TEXT` column (not an
 * activity table, not a jsonb array). The smallest defensible move is
 * to append `\n[YYYY-MM-DD] <content>` so notes stay human-readable
 * and chronological without a migration. If service notes ever need
 * structured activity, that's a separate Service.notes → ServiceActivity
 * migration — not part of this tool.
 *
 * Approval-gated: notes ride along on the listing card; the provider
 * sees the text before it goes in.
 */

import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { defineTool } from '../types';

const parameters = z
  .object({
    serviceId: z.string().min(1).describe('The Service.id to note on.'),
    content: z.string().min(1).max(2000).describe('The note text.'),
  })
  .describe('Append a dated note to a service.');

interface NoteOnServiceResult {
  serviceId: string;
  appendedLine: string;
}

export const noteOnServiceTool = defineTool<typeof parameters, NoteOnServiceResult>({
  name: 'note_on_service',
  riskLevel: 'low',
  description:
    "Add a note to a service's notes log. Prompts for approval first.",
  parameters,
  requiresApproval: true,
  rateLimit: { max: 60, windowSeconds: 3600 },
  summariseCall(args) {
    const preview = args.content.length > 60 ? args.content.slice(0, 57) + '…' : args.content;
    return `Note on service ${args.serviceId.slice(0, 8)}: ${preview}`;
  },

  async handler(args, ctx) {
    const { data: service, error: fetchErr } = await supabase
      .from('Service')
      .select('id, address, notes')
      .eq('id', args.serviceId)
      .eq('spaceId', ctx.space.id)
      .maybeSingle();
    if (fetchErr) {
      return { summary: `Service lookup failed: ${fetchErr.message}`, display: 'error' };
    }
    if (!service) {
      return { summary: `No service with id "${args.serviceId}".`, display: 'error' };
    }

    const today = new Date().toISOString().slice(0, 10);
    const trimmed = args.content.trim();
    const appendedLine = `[${today}] ${trimmed}`;
    const existing = ((service.notes as string | null) ?? '').trim();
    const next = existing ? `${existing}\n${appendedLine}` : appendedLine;

    const { error: updateErr } = await supabase
      .from('Service')
      .update({ notes: next, updatedAt: new Date().toISOString() })
      .eq('id', args.serviceId)
      .eq('spaceId', ctx.space.id);
    if (updateErr) {
      logger.error('[tools.note_on_service] update failed', { serviceId: args.serviceId }, updateErr);
      return { summary: `Note save failed: ${updateErr.message}`, display: 'error' };
    }

    return {
      summary: `Note added to ${service.address}.`,
      data: { serviceId: service.id, appendedLine },
      display: 'success',
    };
  },
});
