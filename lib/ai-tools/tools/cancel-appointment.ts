/**
 * `cancel_appointment` — flip an Appointment to status='cancelled'.
 *
 * Approval-gated: a cancelled appointment drops off the calendar feed and
 * triggers (via cron) the cancel email — worth the provider confirming.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { deleteGoogleEvent } from '@/lib/gcal-helpers';
import { defineTool } from '../types';

const parameters = z
  .object({
    appointmentId: z.string().min(1).describe('The Appointment.id to cancel.'),
    reason: z.string().min(1).max(500).describe('Why the appointment is being cancelled (logged on the contact activity feed).'),
  })
  .describe('Cancel an appointment and log the reason.');

interface CancelAppointmentResult {
  appointmentId: string;
  status: 'cancelled';
}

export const cancelAppointmentTool = defineTool<typeof parameters, CancelAppointmentResult>({
  name: 'cancel_appointment',
  riskLevel: 'destructive',
  description:
    'Cancel an appointment. Records the reason on the linked contact. Prompts for approval first.',
  parameters,
  requiresApproval: true,
  rateLimit: { max: 60, windowSeconds: 3600 },
  summariseCall(args) {
    return `Cancel appointment ${args.appointmentId.slice(0, 8)} — ${args.reason}`;
  },

  async handler(args, ctx) {
    const { data: appointment, error: appointmentErr } = await supabase
      .from('Appointment')
      .select('id, contactId, guestName, serviceAddress, status, googleEventId')
      .eq('id', args.appointmentId)
      .eq('spaceId', ctx.space.id)
      .maybeSingle();
    if (appointmentErr) {
      return { summary: `Appointment lookup failed: ${appointmentErr.message}`, display: 'error' };
    }
    if (!appointment) {
      return { summary: `No appointment with that id.`, display: 'error' };
    }
    if (appointment.status === 'cancelled') {
      return {
        summary: `That appointment is already cancelled.`,
        data: { appointmentId: args.appointmentId, status: 'cancelled' as const },
        display: 'plain',
      };
    }

    const { error: updateErr } = await supabase
      .from('Appointment')
      .update({ status: 'cancelled', updatedAt: new Date().toISOString() })
      .eq('id', args.appointmentId)
      .eq('spaceId', ctx.space.id);
    if (updateErr) {
      logger.error('[tools.cancel_appointment] update failed', { appointmentId: args.appointmentId }, updateErr);
      return { summary: `Cancel failed: ${updateErr.message}`, display: 'error' };
    }

    // Drop the mirrored Google Calendar event — the /api/appointments/[id] PATCH
    // route does this on status=cancelled; the tool path must match or the
    // provider's GCal keeps a ghost slot. Fire-and-forget: DB has committed,
    // a GCal hiccup orphans the event and gcal-helpers logs it for ops.
    const googleEventId = (appointment as { googleEventId?: string | null }).googleEventId;
    if (googleEventId) {
      void deleteGoogleEvent({ spaceId: ctx.space.id, googleEventId }).then(async (ok) => {
        if (ok) {
          // Clear the stale id so a future sync doesn't try to update a
          // deleted event.
          await supabase
            .from('Appointment')
            .update({ googleEventId: null })
            .eq('id', args.appointmentId)
            .eq('spaceId', ctx.space.id);
        }
      });
    }

    if (appointment.contactId) {
      const { error: activityErr } = await supabase.from('ContactActivity').insert({
        id: crypto.randomUUID(),
        spaceId: ctx.space.id,
        contactId: appointment.contactId,
        type: 'note',
        content: `Appointment cancelled: ${args.reason}`,
        metadata: { appointmentId: args.appointmentId, via: 'on_demand_agent' },
      });
      if (activityErr) {
        logger.warn('[tools.cancel_appointment] activity insert failed', { appointmentId: args.appointmentId }, activityErr);
      }
    }

    const guest = (appointment.guestName as string | null) || 'guest';
    return {
      summary: `Appointment for ${guest} cancelled.`,
      data: { appointmentId: args.appointmentId, status: 'cancelled' as const },
      display: 'success',
    };
  },
});
