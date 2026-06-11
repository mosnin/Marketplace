/**
 * `send_service_packet` — log the intent to share a service packet.
 *
 * Approval-gated. **Does NOT send anything.** This tool only writes a
 * ContactActivity row tagged with `kind: 'service_packet'` so the
 * provider's audit trail records that the agent queued the packet. The
 * actual delivery (email pipeline, etc.) is fired elsewhere — the agent
 * never moves bytes over the wire.
 *
 * The Python equivalent in `agent/tools/services.py` creates a real
 * AgentDraft + builds the share URL. The TS chat agent uses the SDK
 * approval flow for messaging tools, so this verb's job is to leave a
 * paper trail that "Koala proposed sending a packet for X to Y."
 */

import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { defineTool } from '../types';

const parameters = z
  .object({
    contactId: z.string().min(1).describe('The Contact.id to share the packet with.'),
    serviceId: z.string().min(1).describe('The Service.id to share.'),
    intent: z
      .string()
      .trim()
      .max(280)
      .optional()
      .describe('Short intent string for the audit log (defaults to "standard").'),
  })
  .describe('Queue a service packet share to a contact.');

interface SendServicePacketResult {
  contactId: string;
  serviceId: string;
  activityId: string;
  status: 'queued';
}

export const sendServicePacketTool = defineTool<typeof parameters, SendServicePacketResult>({
  name: 'send_service_packet',
  riskLevel: 'high',
  description:
    "Queue a service packet share to a contact (logs intent — actual send fires through the email pipeline). Prompts for approval first.",
  parameters,
  requiresApproval: true,
  rateLimit: { max: 60, windowSeconds: 3600 },
  summariseCall(args) {
    const c =
      typeof args?.contactId === 'string' && args.contactId.length > 0
        ? args.contactId.slice(0, 8)
        : 'contact';
    const p =
      typeof args?.serviceId === 'string' && args.serviceId.length > 0
        ? args.serviceId.slice(0, 8)
        : 'service';
    return `Send service packet for ${p} to ${c}`;
  },

  async handler(args, ctx) {
    const { data: contact, error: contactErr } = await supabase
      .from('Contact')
      .select('id, name')
      .eq('id', args.contactId)
      .eq('spaceId', ctx.space.id)
      .maybeSingle();
    if (contactErr) {
      return { summary: `Contact lookup failed: ${contactErr.message}`, display: 'error' };
    }
    if (!contact) {
      return { summary: `No contact with id "${args.contactId}".`, display: 'error' };
    }

    const { data: service, error: serviceErr } = await supabase
      .from('Service')
      .select('id, address')
      .eq('id', args.serviceId)
      .eq('spaceId', ctx.space.id)
      .maybeSingle();
    if (serviceErr) {
      return { summary: `Service lookup failed: ${serviceErr.message}`, display: 'error' };
    }
    if (!service) {
      return { summary: `No service with id "${args.serviceId}".`, display: 'error' };
    }

    const intent = args.intent?.trim() || 'standard';
    const activityId = crypto.randomUUID();
    const { error: activityErr } = await supabase.from('ContactActivity').insert({
      id: activityId,
      contactId: args.contactId,
      spaceId: ctx.space.id,
      type: 'note',
      content: `Queued service packet for ${service.address} (${intent}).`,
      metadata: {
        kind: 'service_packet',
        serviceId: args.serviceId,
        status: 'queued',
        intent,
        via: 'on_demand_agent',
      },
    });
    if (activityErr) {
      logger.error(
        '[tools.send_service_packet] activity insert failed',
        { contactId: args.contactId, serviceId: args.serviceId },
        activityErr,
      );
      return {
        summary: `Couldn't queue the packet: ${activityErr.message}`,
        display: 'error',
      };
    }

    return {
      summary: `Queued service packet for ${service.address} to ${contact.name || 'contact'}.`,
      data: {
        contactId: args.contactId,
        serviceId: args.serviceId,
        activityId,
        status: 'queued',
      },
      display: 'success',
    };
  },
});
