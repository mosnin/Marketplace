/**
 * `reschedule_appointment` — move a Appointment to a new start (and optional end) time.
 *
 * Approval-gated: appointments are on calendars and inboxes; the provider sees
 * the new time before we commit. Google Calendar sync runs server-side
 * on a separate cron job (see schedule-appointment.ts), so we don't duplicate
 * it here — same stance as the create path.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { defineTool } from '../types';

const parameters = z
  .object({
    appointmentId: z.string().min(1).describe('The Appointment.id to reschedule.'),
    newStartsAt: z.string().datetime().describe('New ISO start time.'),
    newEndsAt: z
      .string()
      .datetime()
      .optional()
      .describe('Optional new ISO end. Defaults to preserving the original duration.'),
    why: z.string().max(500).optional(),
  })
  .describe('Move a appointment to a new time.');

interface RescheduleAppointmentResult {
  appointmentId: string;
  startsAt: string;
  endsAt: string;
}

function pretty(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const rescheduleAppointmentTool = defineTool<typeof parameters, RescheduleAppointmentResult>({
  name: 'reschedule_appointment',
  riskLevel: 'low',
  description:
    'Move a appointment to a new time. Preserves the original duration unless newEndsAt is given. Prompts for approval first.',
  parameters,
  requiresApproval: true,
  rateLimit: { max: 60, windowSeconds: 3600 },
  summariseCall(args) {
    const why = args.why ? ` — ${args.why}` : '';
    return `Reschedule appointment ${args.appointmentId.slice(0, 8)} → ${pretty(args.newStartsAt)}${why}`;
  },

  async handler(args, ctx) {
    const { data: appointment, error: appointmentErr } = await supabase
      .from('Appointment')
      .select('id, startsAt, endsAt, contactId, serviceAddress, guestName, status')
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
      return { summary: `That appointment is already cancelled — schedule a new one instead.`, display: 'error' };
    }

    const newStarts = new Date(args.newStartsAt);
    let newEnds: Date;
    if (args.newEndsAt) {
      newEnds = new Date(args.newEndsAt);
      if (newEnds <= newStarts) {
        return { summary: `End time must be after start time.`, display: 'error' };
      }
    } else {
      // Preserve original duration.
      const oldStart = new Date(appointment.startsAt as string).getTime();
      const oldEnd = new Date(appointment.endsAt as string).getTime();
      const duration = Math.max(15 * 60 * 1000, oldEnd - oldStart);
      newEnds = new Date(newStarts.getTime() + duration);
    }

    const { error: updateErr } = await supabase
      .from('Appointment')
      .update({
        startsAt: newStarts.toISOString(),
        endsAt: newEnds.toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .eq('id', args.appointmentId)
      .eq('spaceId', ctx.space.id);
    if (updateErr) {
      logger.error('[tools.reschedule_appointment] update failed', { appointmentId: args.appointmentId }, updateErr);
      return { summary: `Reschedule failed: ${updateErr.message}`, display: 'error' };
    }

    if (appointment.contactId) {
      const { error: activityErr } = await supabase.from('ContactActivity').insert({
        id: crypto.randomUUID(),
        spaceId: ctx.space.id,
        contactId: appointment.contactId,
        type: 'meeting',
        content: `Appointment rescheduled to ${args.newStartsAt}${args.why ? `: ${args.why}` : ''}`,
        metadata: { appointmentId: args.appointmentId, oldStartsAt: appointment.startsAt, newStartsAt: newStarts.toISOString(), via: 'on_demand_agent' },
      });
      if (activityErr) {
        logger.warn('[tools.reschedule_appointment] activity insert failed', { appointmentId: args.appointmentId }, activityErr);
      }
    }

    const guest = (appointment.guestName as string | null) || 'guest';
    return {
      summary: `Appointment for ${guest} rescheduled to ${pretty(newStarts.toISOString())}.`,
      data: { appointmentId: args.appointmentId, startsAt: newStarts.toISOString(), endsAt: newEnds.toISOString() },
      display: 'success',
    };
  },
});
