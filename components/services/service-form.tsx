'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Service, ServiceListingStatus, ServiceType } from '@/lib/types';
import { SERVICE_LISTING_STATUS_OPTIONS, SERVICE_TYPE_OPTIONS } from '@/lib/services';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ServicePhotoEditor } from './service-photo-editor';

type FormValues = Partial<Service>;

interface Props {
  initial?: FormValues;
  onCancel: () => void;
  onSubmit: (values: FormValues) => void;
  submitting?: boolean;
  submitLabel?: string;
}

/**
 * Shared service create/edit form. Field set is intentionally small — a
 * provider adding a service in the middle of their day shouldn't have to
 * fill twenty boxes. Everything except the service name is optional.
 *
 * All inputs are the canonical <Input> / <Textarea> primitives so the form
 * inherits the product's paper-flat polish (no shadow, 2px focus ring,
 * quieter placeholder, 150ms transitions). The status/type pickers are
 * still native <select> for keyboard-first speed; they're styled with the
 * same chain as Input so the row visually aligns.
 *
 * Photos live at the top — a service is what it looks like. The featured
 * photo is `photos[0]` (convention reused from the list + detail pages);
 * the editor lets the provider tap any tile to promote it. The first
 * uploaded photo is featured by default.
 */
export function ServiceForm({ initial = {}, onCancel, onSubmit, submitting, submitLabel = 'Save' }: Props) {
  const [v, setV] = useState<FormValues>({
    listingStatus: 'active',
    photos: [],
    ...initial,
  });

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = (v.address ?? '').trim();
    if (!name) return;
    onSubmit({
      address: name,
      unitNumber: v.unitNumber?.toString().trim() || null,
      city: v.city?.toString().trim() || null,
      stateRegion: v.stateRegion?.toString().trim() || null,
      postalCode: v.postalCode?.toString().trim() || null,
      mlsNumber: v.mlsNumber?.toString().trim() || null,
      listingUrl: v.listingUrl?.toString().trim() || null,
      serviceType: (v.serviceType ?? null) as ServiceType | null,
      listingStatus: (v.listingStatus ?? 'active') as ServiceListingStatus,
      beds: v.beds != null ? Number(v.beds) : null,
      baths: v.baths != null ? Number(v.baths) : null,
      squareFeet: v.squareFeet != null ? Number(v.squareFeet) : null,
      lotSizeSqft: v.lotSizeSqft != null ? Number(v.lotSizeSqft) : null,
      yearBuilt: v.yearBuilt != null ? Number(v.yearBuilt) : null,
      listPrice: v.listPrice != null ? Number(v.listPrice) : null,
      notes: v.notes?.toString() || null,
      photos: Array.isArray(v.photos) ? v.photos : [],
    });
  }

  // Native <select> styled to match <Input> — same height, border, radius,
  // padding, focus ring. Keeps the form a single visual row when the type
  // and status sit next to bed/bath number fields.
  const selectClasses = cn(
    'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base transition-colors duration-150 outline-none md:text-sm',
    'dark:bg-input/30',
    'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Photos first — the provider is showcasing their service, not filing
          paperwork. The featured tile sets what the list, the deal card,
          and the service detail show. */}
      <Field label="Photos">
        <ServicePhotoEditor
          value={v.photos ?? []}
          onChange={(next) => set('photos', next)}
        />
      </Field>

      {/* Service name row — the primary identifier */}
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <Field label="Service name" required>
          <Input
            type="text"
            required
            value={v.address ?? ''}
            onChange={(e) => set('address', e.target.value)}
            placeholder="e.g. 60-min Deep Tissue Massage"
          />
        </Field>
        <Field label="Short code">
          <Input
            type="text"
            value={v.unitNumber ?? ''}
            onChange={(e) => set('unitNumber', e.target.value)}
            placeholder="SKU-01"
          />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label="City / Area">
          <Input type="text" value={v.city ?? ''} onChange={(e) => set('city', e.target.value)} placeholder="e.g. Brooklyn" />
        </Field>
        <Field label="State / Region">
          <Input type="text" value={v.stateRegion ?? ''} onChange={(e) => set('stateRegion', e.target.value)} />
        </Field>
        <Field label="Postal code">
          <Input type="text" value={v.postalCode ?? ''} onChange={(e) => set('postalCode', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Internal reference #">
          <Input
            type="text"
            value={v.mlsNumber ?? ''}
            onChange={(e) => set('mlsNumber', e.target.value)}
            placeholder="Optional ID or code"
          />
        </Field>
        <Field label="Booking / info URL">
          <Input
            type="url"
            value={v.listingUrl ?? ''}
            onChange={(e) => set('listingUrl', e.target.value)}
            placeholder="https://…"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Category">
          <select
            value={v.serviceType ?? ''}
            onChange={(e) => set('serviceType', (e.target.value || null) as ServiceType | null)}
            className={selectClasses}
          >
            <option value="">—</option>
            {SERVICE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={v.listingStatus ?? 'active'}
            onChange={(e) => set('listingStatus', e.target.value as ServiceListingStatus)}
            className={selectClasses}
          >
            {SERVICE_LISTING_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Duration (min)">
          <Input
            type="number"
            step="5"
            min="0"
            value={v.beds ?? ''}
            onChange={(e) => set('beds', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="60"
          />
        </Field>
        <Field label="Max group size">
          <Input
            type="number"
            step="1"
            min="0"
            value={v.baths ?? ''}
            onChange={(e) => set('baths', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="1"
          />
        </Field>
        <Field label="Price ($)">
          <Input
            type="number"
            min="0"
            step="1"
            value={v.listPrice ?? ''}
            onChange={(e) => set('listPrice', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="0"
          />
        </Field>
      </div>

      <Field label="Notes">
        <Textarea
          value={v.notes ?? ''}
          onChange={(e) => set('notes', e.target.value)}
          rows={3}
          placeholder="What clients should know before booking."
        />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={submitting || !(v.address ?? '').trim()}>
          {submitting && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}{required ? ' *' : ''}
      </span>
      {children}
    </label>
  );
}
