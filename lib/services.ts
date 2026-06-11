import type { ServiceType, ServiceListingStatus } from '@/lib/types';

export const SERVICE_TYPE_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: 'single_family', label: 'Single family' },
  { value: 'condo',         label: 'Condo' },
  { value: 'townhouse',     label: 'Townhouse' },
  { value: 'multi_family',  label: 'Multi-family' },
  { value: 'land',          label: 'Land' },
  { value: 'commercial',    label: 'Commercial' },
  { value: 'other',         label: 'Other' },
];

export const SERVICE_LISTING_STATUS_OPTIONS: { value: ServiceListingStatus; label: string }[] = [
  { value: 'active',     label: 'Active' },
  { value: 'pending',    label: 'Pending' },
  { value: 'sold',       label: 'Sold' },
  { value: 'off_market', label: 'Off market' },
  { value: 'owned',      label: 'Owned' },
];

const TYPE_SET = new Set(SERVICE_TYPE_OPTIONS.map((o) => o.value));
const STATUS_SET = new Set(SERVICE_LISTING_STATUS_OPTIONS.map((o) => o.value));

export function isValidServiceType(v: unknown): v is ServiceType {
  return typeof v === 'string' && TYPE_SET.has(v as ServiceType);
}

export function isValidListingStatus(v: unknown): v is ServiceListingStatus {
  return typeof v === 'string' && STATUS_SET.has(v as ServiceListingStatus);
}

/** A single-line display string: "123 Main St #4B, Oakland". */
export function formatServiceAddress(p: {
  address: string;
  unitNumber: string | null;
  city: string | null;
  stateRegion: string | null;
}): string {
  const unit = p.unitNumber ? ` #${p.unitNumber}` : '';
  const cityState = [p.city, p.stateRegion].filter(Boolean).join(', ');
  return cityState ? `${p.address}${unit}, ${cityState}` : `${p.address}${unit}`;
}

/** Short chips like "3bd · 2ba · 1,450 sqft". */
export function formatServiceFacts(p: {
  beds: number | null;
  baths: number | null;
  squareFeet: number | null;
}): string {
  const parts: string[] = [];
  if (p.beds != null) parts.push(`${p.beds}bd`);
  if (p.baths != null) parts.push(`${p.baths}ba`);
  if (p.squareFeet != null) parts.push(`${p.squareFeet.toLocaleString()} sqft`);
  return parts.join(' · ');
}
