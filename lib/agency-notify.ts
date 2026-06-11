/**
 * Helper to create agency notifications.
 * Non-blocking — failures are logged but never throw.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export type AgencyNotificationType =
  | 'member_joined'
  | 'member_removed'
  | 'deal_won'
  | 'deal_created'
  | 'lead_hot'
  | 'review_requested';

export interface NotifyAgencyParams {
  agencyId: string;
  type: AgencyNotificationType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export async function notifyAgency(params: NotifyAgencyParams): Promise<void> {
  const { agencyId, type, title, body, metadata } = params;

  try {
    await supabase.from('AgencyNotification').insert({
      id: crypto.randomUUID(),
      agencyId,
      type,
      title,
      body: body ?? null,
      metadata: metadata ?? null,
      read: false,
    });
  } catch (err) {
    logger.error('[agency-notify] failed to create notification', { type, agencyId }, err);
  }
}
