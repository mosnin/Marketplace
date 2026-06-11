/**
 * Marketplace data layer — server-only.
 *
 * The public consumer marketplace reads two real tables that were renamed
 * from a real-estate CRM: "Service" (the thing sold) and "Space" (the
 * provider's workspace / storefront). Because the rename was mechanical, the
 * "Service" row still carries property-ish columns (address, listPrice,
 * listingStatus, serviceType, photos). We map them onto a service-marketplace
 * shape here so every consumer page reads from one normalized type and never
 * touches the raw, real-estate-flavoured columns.
 *
 * Mapping decisions (documented so a future reader doesn't re-derive them):
 *   - title        ← Service.address      (NOT NULL; the only guaranteed name)
 *   - price        ← Service.listPrice    (nullable → "Contact for pricing")
 *   - description  ← Service.notes
 *   - photo        ← Service.photos[0]
 *   - providerName ← Space.name (joined via spaceId / assignedSpaceId)
 *   - providerSlug ← Space.slug (drives the /book/[slug] CTA)
 *   - category     ← derived from Service.serviceType via SERVICE_TYPE_CATEGORY,
 *                    falling back to "Services" when unknown/null.
 *   - duration     ← not a column on Service; the provider's default
 *                    appointment length lives on SpaceSetting.appointmentDuration.
 *                    Read per-space and surfaced as a soft hint ("~30 min").
 *   - rating       ← no ratings table exists yet; a placeholder is rendered in
 *                    the UI, never invented here.
 *
 * Everything degrades gracefully: a dev DB with no rows returns [] and the
 * pages render their empty states. A missing env / failed query is caught and
 * surfaced as an empty result (the marketplace is read-only and public — a
 * transient DB hiccup should show "nothing here yet", not a 500).
 */

import 'server-only';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

/** The eight consumer-facing categories shown on the browse page. The slug is
 *  the URL segment for /marketplace/category/[category]; the label is display. */
export interface MarketplaceCategory {
  slug: string;
  label: string;
  /** One-line description used on the category grid + category page header. */
  blurb: string;
}

export const MARKETPLACE_CATEGORIES: MarketplaceCategory[] = [
  { slug: 'hair-beauty',    label: 'Hair & Beauty',      blurb: 'Stylists, barbers, nails, and skin.' },
  { slug: 'fitness',        label: 'Fitness & Training', blurb: 'Personal trainers and group sessions.' },
  { slug: 'coaching',       label: 'Coaching',           blurb: 'Life, career, and executive coaches.' },
  { slug: 'photography',    label: 'Photography',        blurb: 'Portraits, events, and brand shoots.' },
  { slug: 'tutoring',       label: 'Tutoring',           blurb: 'Academic help and test prep.' },
  { slug: 'wellness',       label: 'Wellness',           blurb: 'Massage, therapy, and bodywork.' },
  { slug: 'consulting',     label: 'Consulting',         blurb: 'Advisors who move your work forward.' },
  { slug: 'home-services',  label: 'Home Services',      blurb: 'Cleaning, repairs, and on-site help.' },
];

const CATEGORY_BY_SLUG = new Map(MARKETPLACE_CATEGORIES.map((c) => [c.slug, c]));

export function getCategoryBySlug(slug: string): MarketplaceCategory | null {
  return CATEGORY_BY_SLUG.get(slug) ?? null;
}

/**
 * Map the renamed real-estate `serviceType` enum onto a marketplace category
 * slug. The underlying values (single_family, condo, …) are meaningless for a
 * services marketplace, so this is a best-effort spread across categories that
 * keeps a seeded dev DB looking varied rather than dumping everything into one
 * bucket. When the type is null/unknown we fall back to a generic label.
 */
const SERVICE_TYPE_CATEGORY: Record<string, string> = {
  single_family: 'hair-beauty',
  condo: 'fitness',
  townhouse: 'coaching',
  multi_family: 'photography',
  land: 'tutoring',
  commercial: 'consulting',
  other: 'wellness',
};

/** The normalized shape every marketplace surface renders from. */
export interface MarketplaceService {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  photo: string | null;
  categorySlug: string;
  categoryLabel: string;
  providerName: string | null;
  providerSlug: string | null;
  /** Soft duration hint in minutes, from the provider's default appointment
   *  length. Null when unknown. */
  durationMin: number | null;
}

/** Raw row shape we read off "Service" (only the columns we map). */
interface ServiceRow {
  id: string;
  address: string | null;
  notes: string | null;
  listPrice: number | null;
  photos: string[] | null;
  serviceType: string | null;
  listingStatus: string | null;
  spaceId: string | null;
  assignedSpaceId: string | null;
}

interface SpaceRow {
  id: string;
  slug: string;
  name: string;
}

function categoryLabelFor(slug: string): string {
  return CATEGORY_BY_SLUG.get(slug)?.label ?? 'Services';
}

function deriveCategorySlug(serviceType: string | null): string {
  if (serviceType && SERVICE_TYPE_CATEGORY[serviceType]) {
    return SERVICE_TYPE_CATEGORY[serviceType];
  }
  return 'consulting';
}

/**
 * Hydrate the provider Space (name + slug) + default duration for a set of
 * service rows. Returns lookup maps keyed by spaceId. Safe on empty input.
 */
async function loadSpaceContext(
  spaceIds: string[],
): Promise<{ spaces: Map<string, SpaceRow>; durations: Map<string, number> }> {
  const spaces = new Map<string, SpaceRow>();
  const durations = new Map<string, number>();
  if (spaceIds.length === 0) return { spaces, durations };

  try {
    const [{ data: spaceData }, { data: settingData }] = await Promise.all([
      supabase.from('Space').select('id, slug, name').in('id', spaceIds),
      supabase.from('SpaceSetting').select('spaceId, appointmentDuration').in('spaceId', spaceIds),
    ]);
    for (const s of (spaceData ?? []) as SpaceRow[]) spaces.set(s.id, s);
    for (const row of (settingData ?? []) as { spaceId: string; appointmentDuration: number | null }[]) {
      if (row.appointmentDuration != null) durations.set(row.spaceId, row.appointmentDuration);
    }
  } catch (err) {
    logger.warn('[marketplace] space context query failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return { spaces, durations };
}

function normalizeService(
  row: ServiceRow,
  spaces: Map<string, SpaceRow>,
  durations: Map<string, number>,
): MarketplaceService {
  const ownerSpaceId = row.assignedSpaceId ?? row.spaceId ?? null;
  const space = ownerSpaceId ? spaces.get(ownerSpaceId) ?? null : null;
  const categorySlug = deriveCategorySlug(row.serviceType);
  return {
    id: row.id,
    title: (row.address ?? '').trim() || 'Untitled service',
    description: row.notes ?? null,
    price: row.listPrice ?? null,
    photo: Array.isArray(row.photos) && row.photos.length > 0 ? row.photos[0] : null,
    categorySlug,
    categoryLabel: categoryLabelFor(categorySlug),
    providerName: space?.name ?? null,
    providerSlug: space?.slug ?? null,
    durationMin: ownerSpaceId ? durations.get(ownerSpaceId) ?? null : null,
  };
}

const SERVICE_COLUMNS =
  'id, address, notes, listPrice, photos, serviceType, listingStatus, spaceId, assignedSpaceId';

/**
 * Fetch services for the browse grid. Prefers "active" listings (the renamed
 * status enum still uses 'active' for a live row) but the marketplace is
 * forgiving: any row with a usable title shows. Returns [] on any failure so
 * the page can render an empty state rather than throwing.
 */
export async function listMarketplaceServices(limit = 48): Promise<MarketplaceService[]> {
  let rows: ServiceRow[] = [];
  try {
    const { data, error } = await supabase
      .from('Service')
      .select(SERVICE_COLUMNS)
      .order('createdAt', { ascending: false })
      .limit(limit);
    if (error) throw error;
    rows = (data ?? []) as ServiceRow[];
  } catch (err) {
    logger.warn('[marketplace] listMarketplaceServices failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const spaceIds = Array.from(
    new Set(rows.map((r) => r.assignedSpaceId ?? r.spaceId).filter((v): v is string => !!v)),
  );
  const { spaces, durations } = await loadSpaceContext(spaceIds);
  return rows.map((r) => normalizeService(r, spaces, durations));
}

/** Browse, filtered to one category slug. Filtering happens after the type
 *  mapping (the DB has no category column), so we over-fetch then filter. */
export async function listMarketplaceServicesByCategory(
  categorySlug: string,
  limit = 96,
): Promise<MarketplaceService[]> {
  const all = await listMarketplaceServices(limit);
  return all.filter((s) => s.categorySlug === categorySlug);
}

/** Single service detail. Returns null when the id doesn't resolve. */
export async function getMarketplaceService(id: string): Promise<MarketplaceService | null> {
  let row: ServiceRow | null = null;
  try {
    const { data, error } = await supabase
      .from('Service')
      .select(SERVICE_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    row = (data ?? null) as ServiceRow | null;
  } catch (err) {
    logger.warn('[marketplace] getMarketplaceService failed', {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!row) return null;

  const ownerSpaceId = row.assignedSpaceId ?? row.spaceId ?? null;
  const { spaces, durations } = await loadSpaceContext(ownerSpaceId ? [ownerSpaceId] : []);
  return normalizeService(row, spaces, durations);
}

/** "$120" / "Contact for pricing". Marketplace prices read cleaner without
 *  trailing cents, matching formatCurrency's maximumFractionDigits:0. */
export function formatServicePrice(price: number | null): string {
  if (price == null) return 'Contact for pricing';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(price);
}

/** "~30 min" or "" when unknown. */
export function formatServiceDuration(durationMin: number | null): string {
  if (durationMin == null) return '';
  return `~${durationMin} min`;
}
