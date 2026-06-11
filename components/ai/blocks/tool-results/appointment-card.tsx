'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarDays, MapPin, ChevronRight, Phone, Mail, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EntityCard } from '../entity-card';
import { CardSkeleton } from '../card-skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppointmentSummary {
  appointmentId: string;
  startsAt: string;
  endsAt?: string | null;
  contactId?: string | null;
  guestName?: string | null;
  serviceAddress?: string | null;
  status?: string | null;
}

export interface AppointmentDetail {
  appointmentId: string;
  scheduledAt: string;
  endsAt: string | null;
  status: string;
  service: { id: string; address: string; price: number | null } | null;
  contact: { id: string; name: string; phone: string | null; email: string | null } | null;
  notes: string | null;
  duration: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_ICON_BG: Record<string, string> = {
  scheduled: 'bg-amber-500/10',
  confirmed: 'bg-emerald-500/10',
  completed: 'bg-muted',
  cancelled: 'bg-rose-500/10',
  no_show: 'bg-rose-500/10',
};

const STATUS_ICON_COLOR: Record<string, string> = {
  scheduled: 'text-amber-600 dark:text-amber-400',
  confirmed: 'text-emerald-600 dark:text-emerald-400',
  completed: 'text-muted-foreground',
  cancelled: 'text-rose-600 dark:text-rose-400',
  no_show: 'text-rose-600 dark:text-rose-400',
};

const STATUS_CHIP_CLASSES: Record<string, string> = {
  scheduled:
    'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
  confirmed:
    'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15',
  completed: 'text-muted-foreground bg-muted',
  cancelled: 'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/15',
  no_show: 'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/15',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { weekday: 'short', month: 'long', day: 'numeric' });
}

function normalizeStatus(raw: string | null | undefined): string {
  return raw ?? 'scheduled';
}

// ─── Collapsed row ────────────────────────────────────────────────────────────

function AppointmentRow({
  appointment,
  isExpanded,
}: {
  appointment: AppointmentSummary;
  isExpanded: boolean;
}) {
  const status = normalizeStatus(appointment.status);
  const iconBg = STATUS_ICON_BG[status] ?? 'bg-muted';
  const iconColor = STATUS_ICON_COLOR[status] ?? 'text-muted-foreground';
  const chipClass = STATUS_CHIP_CLASSES[status] ?? 'text-muted-foreground bg-muted';

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors">
      {/* Icon */}
      <div
        className={cn(
          'w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0',
          iconBg,
        )}
      >
        <CalendarDays size={14} className={iconColor} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {appointment.serviceAddress ?? 'Appointment'}
          </span>
          {appointment.status && (
            <span
              className={cn(
                'inline-flex text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap flex-shrink-0',
                chipClass,
              )}
            >
              {appointment.status.replace('_', ' ')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
          {appointment.guestName && (
            <span className="truncate">{appointment.guestName}</span>
          )}
          {appointment.guestName && <span>·</span>}
          <span>{formatDateTime(appointment.startsAt)}</span>
        </div>
      </div>

      {/* Chevron */}
      <ChevronRight
        size={13}
        className={cn(
          'flex-shrink-0 text-muted-foreground/60 transition-transform duration-150',
          isExpanded && 'rotate-90',
        )}
      />
    </div>
  );
}

// ─── Expanded detail ──────────────────────────────────────────────────────────

function AppointmentDetail({
  appointment,
  slug,
}: {
  appointment: AppointmentDetail;
  slug: string;
}) {
  const calendarHref = slug ? `/s/${slug}/calendar` : '#';
  const contactHref =
    slug && appointment.contact ? `/s/${slug}/contacts/${appointment.contact.id}` : '#';

  return (
    <div className="space-y-4">
      {/* Timeline block */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-3">
          {formatDate(appointment.scheduledAt)}
        </p>

        <div className="relative pl-4 border-l-2 border-border/60 space-y-3">
          {/* Start time dot + time */}
          <div className="flex items-center gap-2 text-sm font-medium">
            <div className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-foreground" />
            {formatTime(appointment.scheduledAt)}
          </div>

          {/* Details block */}
          <div className="text-sm text-muted-foreground space-y-1">
            {appointment.service && (
              <p className="flex items-center gap-1.5">
                <MapPin size={12} className="flex-shrink-0" />
                {appointment.service.address}
              </p>
            )}
            {appointment.duration != null && (
              <p>{appointment.duration} min appointment</p>
            )}
            {appointment.notes && (
              <p className="italic">{appointment.notes}</p>
            )}
          </div>

          {/* End time dot + time */}
          {appointment.endsAt && (
            <div className="flex items-center gap-2 text-sm font-medium">
              <div className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-muted-foreground" />
              {formatTime(appointment.endsAt)}
            </div>
          )}
        </div>
      </div>

      {/* Contact row */}
      {appointment.contact && (
        <div className="pt-3 border-t border-border/40">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-xs font-semibold text-muted-foreground">
              {appointment.contact.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {appointment.contact.name}
              </p>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {appointment.contact.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone size={10} />
                    {appointment.contact.phone}
                  </span>
                )}
                {appointment.contact.email && (
                  <span className="inline-flex items-center gap-1 truncate">
                    <Mail size={10} />
                    <span className="truncate">{appointment.contact.email}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        <Link
          href={calendarHref}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          View in Calendar
          <ExternalLink size={11} />
        </Link>
        {appointment.contact && (
          <Link
            href={contactHref}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            Contact
            <ExternalLink size={11} />
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── Loading skeleton ──────────────────────────────────────────────────────────

function AppointmentDetailSkeleton() {
  return <CardSkeleton rows={4} />;
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface AppointmentCardProps {
  appointment: AppointmentSummary;
  slug: string;
  animDelay?: number;
}

export function AppointmentCard({ appointment, slug }: AppointmentCardProps) {
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function fetchDetail() {
    if (detail || loading) return;
    setLoading(true);
    setError(false);
    try {
      const url = `/api/cards/appointment/${appointment.appointmentId}${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load appointment.');
      const json = (await res.json()) as AppointmentDetail;
      setDetail(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <EntityCard
      row={(isExpanded) => <AppointmentRow appointment={appointment} isExpanded={isExpanded} />}
      detail={
        loading ? (
          <AppointmentDetailSkeleton />
        ) : error ? (
          <p className="text-[11px] text-muted-foreground">Could not load appointment details.</p>
        ) : detail ? (
          <AppointmentDetail appointment={detail} slug={slug} />
        ) : null
      }
      onExpand={fetchDetail}
    />
  );
}
