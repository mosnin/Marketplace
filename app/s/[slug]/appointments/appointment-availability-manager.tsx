'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Clock,
  CalendarOff,
  Loader2,
  Check,
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
  MapPin,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AvailabilityOverrides } from './availability-overrides';
import { ServiceProfiles } from './service-profiles';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AppointmentSettings {
  appointmentDuration: number;
  appointmentBufferMinutes: number;
  appointmentStartHour: number;
  appointmentEndHour: number;
  appointmentDaysAvailable: number[];
  appointmentBlockedDates: string[];
}

interface ServiceProfile {
  id: string;
  name: string;
  address: string | null;
  appointmentDuration: number;
  isActive: boolean;
}

interface AppointmentAvailabilityManagerProps {
  slug: string;
  initialSettings?: AppointmentSettings;
  serviceProfiles: ServiceProfile[];
  onProfilesUpdate: (profiles: ServiceProfile[]) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 0, label: 'Sunday', short: 'Sun' },
];

const DURATION_OPTIONS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1.5 hours' },
  { value: '120', label: '2 hours' },
];

const BUFFER_OPTIONS = [
  { value: '0', label: 'No buffer' },
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '60 min' },
];

function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12:00 AM';
  if (h === 12) return '12:00 PM';
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

function generateTimeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let h = 0; h <= 23; h++) {
    options.push({ value: String(h), label: formatHour(h) });
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

const DEFAULT_SETTINGS: AppointmentSettings = {
  appointmentDuration: 30,
  appointmentBufferMinutes: 0,
  appointmentStartHour: 7,
  appointmentEndHour: 17,
  appointmentDaysAvailable: [1, 2, 3, 4, 5],
  appointmentBlockedDates: [],
};

// ── Component ──────────────────────────────────────────────────────────────────

export function AppointmentAvailabilityManager({
  slug,
  initialSettings,
  serviceProfiles,
  onProfilesUpdate,
}: AppointmentAvailabilityManagerProps) {
  const [settings, setSettings] = useState<AppointmentSettings>(
    initialSettings ?? DEFAULT_SETTINGS
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showServiceProfiles, setShowServiceProfiles] = useState(false);
  const [showOverrides, setShowOverrides] = useState(false);
  const [newBlockedDate, setNewBlockedDate] = useState('');

  // Track if changes have been made
  function updateSettings(partial: Partial<AppointmentSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    setDirty(true);
    setSaved(false);
  }

  function toggleDay(day: number) {
    const current = settings.appointmentDaysAvailable;
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort();
    updateSettings({ appointmentDaysAvailable: next });
  }

  function addBlockedDate() {
    if (!newBlockedDate) return;
    if (settings.appointmentBlockedDates.includes(newBlockedDate)) return;
    updateSettings({
      appointmentBlockedDates: [...settings.appointmentBlockedDates, newBlockedDate].sort(),
    });
    setNewBlockedDate('');
  }

  function removeBlockedDate(date: string) {
    updateSettings({
      appointmentBlockedDates: settings.appointmentBlockedDates.filter((d) => d !== date),
    });
  }

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/spaces', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          appointmentDuration: settings.appointmentDuration,
          appointmentBufferMinutes: settings.appointmentBufferMinutes,
          appointmentStartHour: settings.appointmentStartHour,
          appointmentEndHour: settings.appointmentEndHour,
          appointmentDaysAvailable: settings.appointmentDaysAvailable,
          appointmentBlockedDates: settings.appointmentBlockedDates,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setDirty(false);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || "Couldn't save those settings. Try again.");
      }
    } catch (err) {
      console.error('[AppointmentSettings] Save failed:', err);
      setSaveError("I lost the connection. Try again.");
    } finally {
      setSaving(false);
    }
  }, [slug, settings]);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  // Filter out past blocked dates for display
  const today = new Date().toISOString().split('T')[0];
  const futureBlockedDates = settings.appointmentBlockedDates.filter(
    (d) => d >= today
  );

  return (
    <div className="space-y-6">
      {/* ── Section 1: Appointment Settings ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock size={18} className="text-primary" />
            Appointment Settings
          </CardTitle>
          <CardDescription>
            Set how long appointments last and the buffer time between them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Appointment Duration</label>
              <Select
                value={String(settings.appointmentDuration)}
                onValueChange={(v) =>
                  updateSettings({ appointmentDuration: Number(v) })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                How long each appointment appointment lasts.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Buffer Time</label>
              <Select
                value={String(settings.appointmentBufferMinutes)}
                onValueChange={(v) =>
                  updateSettings({ appointmentBufferMinutes: Number(v) })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUFFER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Padding between back-to-back appointments.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 2: Weekly Schedule Grid ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly Schedule</CardTitle>
          <CardDescription>
            Toggle which days you are available and set your hours. Visitors can
            only book appointments during these windows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Global appointment hours */}
          <div className="flex items-center gap-3 rounded-lg bg-muted/40 border border-border px-4 py-3 mb-4">
            <span className="text-sm font-medium min-w-[80px]">Appointment hours</span>
            <Select
              value={String(settings.appointmentStartHour)}
              onValueChange={(v) => updateSettings({ appointmentStartHour: Number(v) })}
            >
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_OPTIONS.filter((o) => Number(o.value) < settings.appointmentEndHour).map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">to</span>
            <Select
              value={String(settings.appointmentEndHour)}
              onValueChange={(v) => updateSettings({ appointmentEndHour: Number(v) })}
            >
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_OPTIONS.filter((o) => Number(o.value) > settings.appointmentStartHour).map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
                <SelectItem value="24">12:00 AM (midnight)</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground ml-1">Applies to all active days</span>
          </div>

          {/* Day toggles */}
          <div className="space-y-1">
            {DAYS_OF_WEEK.map((day) => {
              const isActive = settings.appointmentDaysAvailable.includes(day.value);
              const isWeekend = day.value === 0 || day.value === 6;

              return (
                <div
                  key={day.value}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
                    isActive
                      ? 'bg-primary/5 border border-primary/10'
                      : 'bg-muted/30 border border-transparent'
                  )}
                >
                  <span
                    className={cn(
                      'text-sm font-medium flex-1',
                      isActive ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {day.label}
                    {isWeekend && (
                      <Badge variant="secondary" className="text-[10px] py-0 px-1.5 ml-2">
                        Weekend
                      </Badge>
                    )}
                  </span>
                  {isActive && (
                    <span className="text-xs text-muted-foreground">
                      {TIME_OPTIONS.find((o) => o.value === String(settings.appointmentStartHour))?.label ?? ''} – {TIME_OPTIONS.find((o) => o.value === String(settings.appointmentEndHour))?.label ?? ''}
                    </span>
                  )}
                  <Switch
                    checked={isActive}
                    onCheckedChange={() => toggleDay(day.value)}
                  />
                </div>
              );
            })}
          </div>

          {settings.appointmentDaysAvailable.length === 0 && (
            <p className="text-xs text-destructive mt-3">
              You need at least one available day for visitors to book appointments.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Section 3: Blocked Dates ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarOff size={18} className="text-destructive" />
            Blocked Dates
          </CardTitle>
          <CardDescription>
            Block specific dates when you are unavailable (holidays, vacations,
            etc.). Appointments cannot be booked on these dates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Add blocked date */}
          <div className="flex items-end gap-3 mb-4">
            <div className="flex-1 max-w-xs space-y-1.5">
              <label className="text-sm font-medium">Block a Date</label>
              <input
                type="date"
                value={newBlockedDate}
                min={minDate}
                onChange={(e) => setNewBlockedDate(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={addBlockedDate}
              disabled={!newBlockedDate}
              className="gap-1.5"
            >
              <Plus size={14} />
              Block
            </Button>
          </div>

          {/* List of blocked dates */}
          {futureBlockedDates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No dates blocked. Your weekly schedule applies to all upcoming
              dates.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {futureBlockedDates.map((date) => {
                const d = new Date(date + 'T12:00:00');
                const label = d.toLocaleDateString([], {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                return (
                  <Badge
                    key={date}
                    variant="outline"
                    className="gap-1.5 py-1.5 px-3 text-sm border-destructive/30 bg-destructive/5"
                  >
                    <CalendarOff size={12} className="text-destructive" />
                    {label}
                    <button
                      type="button"
                      onClick={() => removeBlockedDate(date)}
                      className="ml-1 rounded-full hover:bg-destructive/10 p-0.5 transition-colors"
                      title="Unblock date"
                    >
                      <Trash2
                        size={12}
                        className="text-muted-foreground hover:text-destructive"
                      />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Save bar ────────────────────────────────────────────────────────── */}
      {dirty && (
        <div className="sticky bottom-4 z-30">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg">
            <p className="text-sm text-muted-foreground">
              You have unsaved changes to your appointment availability.
            </p>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {saving ? 'Saving' : 'Save Changes'}
            </Button>
          </div>
        </div>
      )}
      {saved && !dirty && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <Check size={14} />
          Availability saved.
        </div>
      )}
      {saveError && (
        <p className="text-sm text-destructive">{saveError}</p>
      )}

      {/* ── Section 4: Schedule Overrides (collapsed) ───────────────────────── */}
      <div className="border-t border-border pt-6">
        <button
          type="button"
          onClick={() => setShowOverrides(!showOverrides)}
          className="flex items-center justify-between w-full text-left group"
        >
          <div>
            <h3 className="text-sm font-semibold group-hover:text-primary transition-colors">
              Schedule Overrides
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Set custom hours or block specific dates with recurring rules.
              Overrides take priority over your weekly schedule.
            </p>
          </div>
          {showOverrides ? (
            <ChevronUp size={16} className="text-muted-foreground" />
          ) : (
            <ChevronDown size={16} className="text-muted-foreground" />
          )}
        </button>
        {showOverrides && (
          <div className="mt-4">
            <AvailabilityOverrides
              slug={slug}
              serviceProfiles={serviceProfiles}
            />
          </div>
        )}
      </div>

      {/* ── Section 5: Service Profiles (collapsed) ────────────────────────── */}
      <div className="border-t border-border pt-6">
        <button
          type="button"
          onClick={() => setShowServiceProfiles(!showServiceProfiles)}
          className="flex items-center justify-between w-full text-left group"
        >
          <div>
            <h3 className="text-sm font-semibold group-hover:text-primary transition-colors flex items-center gap-2">
              <MapPin size={14} />
              Service Profiles
              {serviceProfiles.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {serviceProfiles.length}
                </Badge>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Give each listing its own appointment schedule, duration, and booking
              link.
            </p>
          </div>
          {showServiceProfiles ? (
            <ChevronUp size={16} className="text-muted-foreground" />
          ) : (
            <ChevronDown size={16} className="text-muted-foreground" />
          )}
        </button>
        {showServiceProfiles && (
          <div className="mt-4">
            <ServiceProfiles
              slug={slug}
              profiles={serviceProfiles as any}
              onUpdate={onProfilesUpdate as any}
            />
          </div>
        )}
      </div>
    </div>
  );
}
