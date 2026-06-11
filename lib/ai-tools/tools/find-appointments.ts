/**
 * `find_appointments` — read-only lookup over the Appointment table.
 *
 * Four filters cover 95% of the provider's questions:
 *   - "what appointments does Jane have on the books?"   → personId
 *   - "what appointments are scheduled for that listing?" → serviceId
 *   - "what's on the calendar this week?"          → fromDate/toDate
 *   - "any cancelled appointments I should know about?"   → status
 *
 * Anything beyond that is gold-plating; cut.
 */

import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { defineTool } from '../types';

const parameters = z
  .object({
    personId: z.string().min(1).optional().describe('Contact.id to filter by.'),
    serviceId: z.string().min(1).optional().describe('Service.id to filter by.'),
    fromDate: z.string().datetime().optional().describe('ISO start of the window (inclusive).'),
    toDate: z.string().datetime().optional().describe('ISO end of the window (inclusive).'),
    status: z
      .enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'])
      .optional()
      .describe('Limit to a single status.'),
  })
  .describe('Find appointments by person, service, date window, or status.');

interface AppointmentRow {
  id: string;
  startsAt: string;
  endsAt: string;
  serviceAddress: string | null;
  guestName: string;
  status: string;
}

interface FindAppointmentsResult {
  appointments: AppointmentRow[];
}

export const findAppointmentsTool = defineTool<typeof parameters, FindAppointmentsResult>({
  name: 'find_appointments',
  riskLevel: 'safe',
  description:
    "List appointments filtered by person, service, date range, or status. Up to 20, sorted by start time.",
  parameters,
  requiresApproval: false,

  async handler(args, ctx) {
    let query = supabase
      .from('Appointment')
      .select('id, startsAt, endsAt, serviceAddress, guestName, status')
      .eq('spaceId', ctx.space.id)
      .order('startsAt', { ascending: true })
      .limit(20);

    if (args.personId) query = query.eq('contactId', args.personId);
    if (args.serviceId) query = query.eq('serviceId', args.serviceId);
    if (args.status) query = query.eq('status', args.status);
    if (args.fromDate) query = query.gte('startsAt', args.fromDate);
    if (args.toDate) query = query.lte('startsAt', args.toDate);

    const { data, error } = await query.abortSignal(ctx.signal);
    if (error) {
      return { summary: `Appointment lookup failed: ${error.message}`, display: 'error' };
    }

    const appointments = (data ?? []) as AppointmentRow[];
    if (appointments.length === 0) {
      return {
        summary: 'No appointments matched.',
        data: { appointments: [] },
        display: 'appointments',
      };
    }

    const lines = appointments.slice(0, 5).map((t) => {
      const when = new Date(t.startsAt).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      const where = t.serviceAddress ? ` at ${t.serviceAddress}` : '';
      return `• ${when} — ${t.guestName}${where} (${t.status})`;
    });
    const more = appointments.length > 5 ? `\n…and ${appointments.length - 5} more.` : '';

    return {
      summary: `${appointments.length} appointment${appointments.length === 1 ? '' : 's'}:\n${lines.join('\n')}${more}`,
      data: { appointments },
      display: 'appointments',
    };
  },
});
