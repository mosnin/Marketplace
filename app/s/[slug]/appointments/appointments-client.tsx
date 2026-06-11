'use client';

import { useState, useCallback } from 'react';
import {
  CalendarDays,
  MapPin,
  User,
  Mail,
  Phone,
  Check,
  X,
  Copy,
  MoreHorizontal,
  CalendarPlus,
  Loader2,
  Briefcase,
  Search,
  LayoutGrid,
  List,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useRealtime } from '@/hooks/use-realtime';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AppointmentAvailabilityManager } from './appointment-availability-manager';
import { AppointmentPrepCard } from '@/components/appointments/appointment-prep-card';
import { AppointmentTimeline } from '@/components/appointments/appointment-timeline';
import { AppointmentStatsStrip } from '@/components/appointments/appointment-stats-strip';
import { AppointmentFeedbackBadge } from '@/components/appointments/appointment-feedback-badge';
import {
  H1,
  H2,
  H3,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_LABEL,
  PAGE_RHYTHM,
  SECTION_RHYTHM,
} from '@/lib/typography';

type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

interface Appointment {
  id: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  serviceAddress: string | null;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  googleEventId: string | null;
  sourceDealId: string | null;
  createdAt?: string;
  Contact: { id: string; name: string; email: string | null; phone: string | null } | null;
}

interface ServiceProfile {
  id: string;
  name: string;
  address: string | null;
  appointmentDuration: number;
  isActive: boolean;
}

interface AppointmentSettings {
  appointmentDuration: number;
  appointmentBufferMinutes: number;
  appointmentStartHour: number;
  appointmentEndHour: number;
  appointmentDaysAvailable: number[];
  appointmentBlockedDates: string[];
}

interface AppointmentsClientProps {
  slug: string;
  spaceId: string;
  initialAppointments: Appointment[];
  hasGoogleCalendar: boolean;
  bookingUrl: string;
  serviceProfiles?: ServiceProfile[];
  appointmentSettings?: AppointmentSettings;
}

const STATUS_CONFIG: Record<AppointmentStatus, { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  confirmed: { label: 'Confirmed', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  completed: { label: 'Completed', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  no_show: { label: 'No Show', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
};

type FilterTab = 'upcoming' | 'past' | 'all' | 'availability';

export function AppointmentsClient({ slug, spaceId, initialAppointments, hasGoogleCalendar, bookingUrl, serviceProfiles: initialProfiles = [], appointmentSettings: initialAppointmentSettings }: AppointmentsClientProps) {
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);
  const [tab, setTab] = useState<FilterTab>('upcoming');
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<'table' | 'card'>('table');
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [embedCopied, setEmbedCopied] = useState(false);
  const router = useRouter();

  // --- Supabase Realtime: keep appointments in sync across tabs / devices ---
  useRealtime<Record<string, unknown>>({
    table: 'Appointment',
    filter: `spaceId=eq.${spaceId}`,
    onEvent: (payload) => {
      if (payload.eventType === 'INSERT') {
        const newAppointment = payload.new as unknown as Appointment;
        setAppointments((prev) => {
          // Avoid duplicates (e.g. if we just created it locally)
          if (prev.some((t) => t.id === newAppointment.id)) return prev;
          return [newAppointment, ...prev];
        });
      } else if (payload.eventType === 'UPDATE') {
        const updated = payload.new as unknown as Appointment;
        setAppointments((prev) =>
          prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
        );
      } else if (payload.eventType === 'DELETE') {
        const deleted = payload.old as unknown as { id: string };
        if (deleted?.id) {
          setAppointments((prev) => prev.filter((t) => t.id !== deleted.id));
        }
      }
    },
  });

  const now = new Date();
  const searchLower = searchQuery.toLowerCase().trim();
  const filtered = appointments.filter((t) => {
    const start = new Date(t.startsAt);
    if (tab === 'upcoming' && !(start >= now && t.status !== 'cancelled')) return false;
    if (tab === 'past' && !(start < now || t.status === 'completed')) return false;
    if (searchLower) {
      return (
        t.guestName.toLowerCase().includes(searchLower) ||
        (t.guestEmail?.toLowerCase().includes(searchLower) ?? false) ||
        (t.guestPhone?.toLowerCase().includes(searchLower) ?? false) ||
        (t.serviceAddress?.toLowerCase().includes(searchLower) ?? false) ||
        (t.notes?.toLowerCase().includes(searchLower) ?? false) ||
        (t.Contact?.name.toLowerCase().includes(searchLower) ?? false)
      );
    }
    return true;
  });

  const updateStatus = useCallback(async (appointmentId: string, status: AppointmentStatus) => {
    setUpdatingId(appointmentId);
    setActionMenuId(null);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json();
        setAppointments((prev) => prev.map((t) => (t.id === appointmentId ? { ...t, ...updated } : t)));
      } else {
        const data = await res.json().catch(() => ({}));
        console.error('[Appointments] Status update failed:', data.error);
      }
    } catch (err) {
      console.error('[Appointments] Status update error:', err);
    } finally {
      setUpdatingId(null);
    }
  }, []);

  const syncToGcal = useCallback(async (appointmentId: string) => {
    setSyncingId(appointmentId);
    try {
      const res = await fetch('/api/appointments/gcal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, action: 'sync_appointment', appointmentId }),
      });
      if (res.ok) {
        const data = await res.json();
        setAppointments((prev) =>
          prev.map((t) => (t.id === appointmentId ? { ...t, googleEventId: data.googleEventId } : t))
        );
      }
    } catch (err) {
      console.error('[Appointments] Sync failed:', err);
    } finally {
      setSyncingId(null);
    }
  }, [slug]);

  const convertToDeal = useCallback(async (appointmentId: string) => {
    setConvertingId(appointmentId);
    try {
      const res = await fetch('/api/appointments/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, appointmentId }),
      });
      if (res.ok) {
        const data = await res.json();
        setAppointments((prev) =>
          prev.map((t) => (t.id === appointmentId ? { ...t, sourceDealId: data.deal.id } : t))
        );
        router.push(`/s/${slug}/deals/${data.deal.id}`);
      } else if (res.status === 409) {
        const data = await res.json();
        if (data.dealId) router.push(`/s/${slug}/deals/${data.dealId}`);
      }
    } catch (err) {
      console.error('[Appointments] Convert failed:', err);
    } finally {
      setConvertingId(null);
    }
  }, [slug, router]);

  function formatDateTime(iso: string) {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
      time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    };
  }

  function getDuration(start: string, end: string) {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return Math.round(ms / 60000);
  }

  return (
    <div className={PAGE_RHYTHM}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <h1 className={H1} style={TITLE_FONT}>
          Appointments
        </h1>
        <div className="flex items-center gap-1">
          {/* View toggle — small two-icon segmented control */}
          <div className="flex rounded-md border border-border/70 overflow-hidden bg-background">
            <button
              type="button"
              onClick={() => setView('table')}
              className={cn(
                'px-2.5 py-1.5 flex items-center justify-center transition-colors duration-150',
                view === 'table'
                  ? 'bg-foreground/[0.045] text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
              )}
              title="Table view"
              aria-label="Table view"
            >
              <List size={14} />
            </button>
            <button
              type="button"
              onClick={() => setView('card')}
              className={cn(
                'px-2.5 py-1.5 flex items-center justify-center transition-colors duration-150',
                view === 'card'
                  ? 'bg-foreground/[0.045] text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
              )}
              title="Card view"
              aria-label="Card view"
            >
              <LayoutGrid size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by guest, email, phone, or address…"
          className="h-9 w-full rounded-lg border border-border bg-muted/60 pl-9 pr-8 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:bg-background transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Stats */}
      <AppointmentStatsStrip appointments={appointments.map((t) => ({ startsAt: t.startsAt, status: t.status, sourceDealId: t.sourceDealId, createdAt: t.createdAt }))} />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/70">
        {(['upcoming', 'past', 'all', 'availability'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors duration-150 border-b-2 -mb-px',
              tab === t
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t === 'upcoming' ? 'Upcoming' : t === 'past' ? 'Past' : t === 'all' ? 'All' : 'Availability'}
          </button>
        ))}
      </div>

      {/* Availability tab */}
      {tab === 'availability' && (
        <div className={SECTION_RHYTHM}>
          <AppointmentAvailabilityManager
            slug={slug}
            initialSettings={initialAppointmentSettings}
            serviceProfiles={profiles}
            onProfilesUpdate={setProfiles as any}
          />

          {/* Embed Code */}
          <div className="border-t border-border pt-6 space-y-3">
            <div>
              <h3 className={H3}>Embed Booking Widget</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Paste this code into your website or listing page to let visitors book appointments directly.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <code className="text-xs text-foreground break-all block">
                {`<iframe src="${typeof window !== 'undefined' ? window.location.origin : ''}/book/${slug}/embed" width="100%" height="600" frameborder="0" style="border: none; border-radius: 16px;"></iframe>`}
              </code>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const code = `<iframe src="${window.location.origin}/book/${slug}/embed" width="100%" height="600" frameborder="0" style="border: none; border-radius: 16px;"></iframe>`;
                navigator.clipboard.writeText(code);
                setEmbedCopied(true);
                setTimeout(() => setEmbedCopied(false), 2000);
              }}
              className="gap-1.5"
            >
              {embedCopied ? <Check size={14} /> : <Copy size={14} />}
              {embedCopied ? 'Copied!' : 'Copy Embed Code'}
            </Button>
          </div>
        </div>
      )}

      {/* Appointment list */}
      {tab !== 'availability' && filtered.length === 0 ? (
        <div className="flex flex-col items-center text-center py-16 space-y-3">
          <CalendarDays size={28} className="text-muted-foreground/40" />
          <p className={H2} style={TITLE_FONT}>
            No {tab === 'all' ? '' : tab + ' '}appointments yet
          </p>
          <p className={`${BODY_MUTED} max-w-sm`}>
            Share your booking link to start receiving appointment requests.
          </p>
        </div>
      ) : tab !== 'availability' ? (
        view === 'table' ? (
          /* ── Table view ── */
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className={cn('text-left px-4 py-3', SECTION_LABEL)}>Guest</th>
                    <th className={cn('text-left px-4 py-3 hidden sm:table-cell', SECTION_LABEL)}>Date & Time</th>
                    <th className={cn('text-left px-4 py-3 hidden md:table-cell', SECTION_LABEL)}>Service</th>
                    <th className={cn('text-left px-4 py-3', SECTION_LABEL)}>Status</th>
                    <th className={cn('text-left px-4 py-3 hidden lg:table-cell', SECTION_LABEL)}>Contact</th>
                    <th className="px-4 py-3 w-16" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {filtered.map((appointment) => {
                    const { date, time } = formatDateTime(appointment.startsAt);
                    const endTime = formatDateTime(appointment.endsAt).time;
                    const dur = getDuration(appointment.startsAt, appointment.endsAt);
                    const statusConf = STATUS_CONFIG[appointment.status];
                    const isPast = new Date(appointment.startsAt) < now;

                    return (
                      <tr
                        key={appointment.id}
                        className={cn(
                          'group hover:bg-muted/30 transition-colors',
                          isPast && appointment.status !== 'completed' && 'opacity-70',
                        )}
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium">{appointment.guestName}</p>
                            <p className="text-xs text-muted-foreground">{appointment.guestEmail}</p>
                            {appointment.guestPhone && (
                              <p className="text-xs text-muted-foreground sm:hidden">{appointment.guestPhone}</p>
                            )}
                            {/* Show date on mobile since the date column is hidden */}
                            <p className="text-xs text-muted-foreground mt-0.5 sm:hidden">{date} {time}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <p className="text-sm">{date}</p>
                          <p className="text-xs text-muted-foreground">{time} – {endTime} ({dur} min)</p>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                          {appointment.serviceAddress ? (
                            <span className="flex items-center gap-1"><MapPin size={10} /> {appointment.serviceAddress}</span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap', statusConf.color)}>
                            {statusConf.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-xs">
                          {appointment.Contact ? (
                            <a
                              href={`/s/${slug}/contacts/${appointment.Contact.id}`}
                              className="text-muted-foreground hover:text-foreground hover:underline"
                            >
                              {appointment.Contact.name}
                            </a>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="relative">
                            <button
                              onClick={() => setActionMenuId(actionMenuId === appointment.id ? null : appointment.id)}
                              disabled={updatingId === appointment.id || convertingId === appointment.id}
                              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors disabled:opacity-50"
                            >
                              {updatingId === appointment.id ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
                            </button>
                            {actionMenuId === appointment.id && (
                              <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-border bg-card shadow-lg dark:shadow-none py-1">
                                {appointment.status === 'scheduled' && (
                                  <button onClick={() => updateStatus(appointment.id, 'confirmed')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors">
                                    Confirm
                                  </button>
                                )}
                                {(appointment.status === 'scheduled' || appointment.status === 'confirmed') && (
                                  <>
                                    <button onClick={() => updateStatus(appointment.id, 'completed')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors">
                                      Mark Completed
                                    </button>
                                    <button onClick={() => updateStatus(appointment.id, 'no_show')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors">
                                      Mark No-Show
                                    </button>
                                    <button onClick={() => updateStatus(appointment.id, 'cancelled')} className="w-full text-left px-3 py-1.5 text-xs text-destructive hover:bg-accent transition-colors">
                                      Cancel Appointment
                                    </button>
                                  </>
                                )}
                                {(appointment.status === 'completed' || appointment.status === 'confirmed') && !appointment.sourceDealId && (
                                  <button
                                    onClick={() => { setActionMenuId(null); convertToDeal(appointment.id); }}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center gap-1.5"
                                  >
                                    <Briefcase size={11} />
                                    {convertingId === appointment.id ? 'Creating...' : 'Create Deal'}
                                  </button>
                                )}
                                {appointment.sourceDealId && (
                                  <a
                                    href={`/s/${slug}/deals/${appointment.sourceDealId}`}
                                    className="w-full block text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors text-foreground"
                                  >
                                    View Deal
                                  </a>
                                )}
                                {appointment.status === 'cancelled' && (
                                  <button onClick={() => updateStatus(appointment.id, 'scheduled')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors">
                                    Reschedule
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* ── Card view (existing) ── */
          <div className="space-y-3">
          {filtered.map((appointment) => {
            const { date, time } = formatDateTime(appointment.startsAt);
            const endTime = formatDateTime(appointment.endsAt).time;
            const dur = getDuration(appointment.startsAt, appointment.endsAt);
            const statusConf = STATUS_CONFIG[appointment.status];
            const isPast = new Date(appointment.startsAt) < now;

            return (
              <div
                key={appointment.id}
                className={cn(
                  'relative rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/20',
                  isPast && appointment.status !== 'completed' && 'opacity-70'
                )}
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  {/* Date/time column */}
                  <div className="flex items-center gap-3 sm:min-w-[180px]">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <CalendarDays size={18} className="text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{date}</p>
                      <p className="text-xs text-muted-foreground">
                        {time} – {endTime} ({dur} min)
                      </p>
                    </div>
                  </div>

                  {/* Guest info */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <User size={13} className="text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{appointment.guestName}</span>
                      <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', statusConf.color)}>
                        {statusConf.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Mail size={11} /> {appointment.guestEmail}</span>
                      {appointment.guestPhone && <span className="flex items-center gap-1"><Phone size={11} /> {appointment.guestPhone}</span>}
                      {appointment.serviceAddress && <span className="flex items-center gap-1"><MapPin size={11} /> {appointment.serviceAddress}</span>}
                    </div>
                    {appointment.notes && (
                      <p className="text-xs text-muted-foreground/80 italic mt-1">{appointment.notes}</p>
                    )}
                    {appointment.Contact && (
                      <a
                        href={`/s/${slug}/contacts/${appointment.Contact.id}`}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline mt-1"
                      >
                        Linked: {appointment.Contact.name}
                      </a>
                    )}
                    <div className="flex items-center gap-3">
                      <AppointmentTimeline
                        status={appointment.status}
                        createdAt={appointment.createdAt}
                        startsAt={appointment.startsAt}
                        googleEventId={appointment.googleEventId}
                        sourceDealId={appointment.sourceDealId}
                      />
                      <AppointmentFeedbackBadge appointmentId={appointment.id} slug={slug} status={appointment.status} />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 sm:flex-shrink-0 relative">
                    {!isPast && appointment.status !== 'cancelled' && (
                      <AppointmentPrepCard appointmentId={appointment.id} />
                    )}
                    {hasGoogleCalendar && !appointment.googleEventId && appointment.status !== 'cancelled' && (
                      <button
                        onClick={() => syncToGcal(appointment.id)}
                        disabled={syncingId === appointment.id}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs border border-border hover:bg-accent transition-colors disabled:opacity-50"
                        title="Sync to Google Calendar"
                      >
                        {syncingId === appointment.id ? <Loader2 size={12} className="animate-spin" /> : <CalendarPlus size={12} />}
                        Sync
                      </button>
                    )}
                    {appointment.googleEventId && (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                        <Check size={10} /> Synced
                      </span>
                    )}

                    <div className="relative">
                      <button
                        onClick={() => setActionMenuId(actionMenuId === appointment.id ? null : appointment.id)}
                        disabled={updatingId === appointment.id || convertingId === appointment.id}
                        className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        {updatingId === appointment.id ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
                      </button>
                      {actionMenuId === appointment.id && (
                        <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-border bg-card shadow-lg dark:shadow-none py-1">
                          {appointment.status === 'scheduled' && (
                            <button onClick={() => updateStatus(appointment.id, 'confirmed')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors">
                              Confirm
                            </button>
                          )}
                          {(appointment.status === 'scheduled' || appointment.status === 'confirmed') && (
                            <>
                              <button onClick={() => updateStatus(appointment.id, 'completed')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors">
                                Mark Completed
                              </button>
                              <button onClick={() => updateStatus(appointment.id, 'no_show')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors">
                                Mark No-Show
                              </button>
                              <button onClick={() => updateStatus(appointment.id, 'cancelled')} className="w-full text-left px-3 py-1.5 text-xs text-destructive hover:bg-accent transition-colors">
                                Cancel Appointment
                              </button>
                            </>
                          )}
                          {(appointment.status === 'completed' || appointment.status === 'confirmed') && !appointment.sourceDealId && (
                            <button
                              onClick={() => { setActionMenuId(null); convertToDeal(appointment.id); }}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center gap-1.5"
                            >
                              <Briefcase size={11} />
                              {convertingId === appointment.id ? 'Creating...' : 'Create Deal'}
                            </button>
                          )}
                          {appointment.sourceDealId && (
                            <a
                              href={`/s/${slug}/deals/${appointment.sourceDealId}`}
                              className="w-full block text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors text-foreground"
                            >
                              View Deal
                            </a>
                          )}
                          {appointment.status === 'cancelled' && (
                            <button onClick={() => updateStatus(appointment.id, 'scheduled')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors">
                              Reschedule
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )
      ) : null}
    </div>
  );
}
