'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Building2, X, Search, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Service } from '@/lib/types';
import { formatServiceAddress, formatServiceFacts } from '@/lib/services';
import { formatCurrency } from '@/lib/formatting';
import { ServiceStatusBadge } from '@/components/services/service-status-badge';

interface Props {
  dealId: string;
  slug: string;
  initial: Service | null;
}

/**
 * Compact service picker for the deal sidebar. Live search against
 * /api/services, debounced. Services have their own create flow at
 * /s/[slug]/services/new — pickers stay focused on search. When no
 * match exists, the empty state links out to the create page.
 */
export function DealServicePicker({ dealId, slug, initial }: Props) {
  const [linked, setLinked] = useState<Service | null>(initial);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Service[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/services?slug=${encodeURIComponent(slug)}&search=${encodeURIComponent(query)}`);
        if (res.ok) setResults(await res.json());
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open, slug]);

  async function link(p: Service | null) {
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: p?.id ?? null }),
      });
      if (!res.ok) { toast.error("Couldn't link the service."); return; }
      setLinked(p);
      setOpen(false);
      setQuery('');
      toast.success(p ? 'Service linked.' : 'Service unlinked.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Building2 size={12} /> Service
      </p>

      {linked ? (
        <div className="flex items-start gap-2.5">
          <div className="w-10 h-10 rounded-md bg-muted flex-shrink-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {linked.photos[0] ? (
              <img
                src={linked.photos[0]}
                alt={formatServiceAddress(linked)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                <Building2 size={14} />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <Link
              href={`/s/${slug}/services/${linked.id}`}
              className="text-sm font-medium hover:underline inline-flex items-center gap-1"
            >
              {formatServiceAddress(linked)}
              <ExternalLink size={10} />
            </Link>
            <p className="text-[11px] text-muted-foreground truncate">
              {[formatServiceFacts(linked), linked.listPrice != null ? formatCurrency(linked.listPrice) : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="mt-1">
              <ServiceStatusBadge status={linked.listingStatus} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => link(null)}
            disabled={saving}
            className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Unlink"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No service linked — link one to share a packet.</p>
      )}

      {/* Picker toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
      >
        {linked ? 'Change…' : 'Link a service…'}
      </button>

      {open && (
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search address, city, MLS#"
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded border border-border bg-transparent"
            />
          </div>

          {searching && <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Searching…</p>}

          {results.length === 0 && !searching && (
            <p className="text-[11px] text-muted-foreground">
              {query.trim().length > 0 ? (
                <>
                  No matches.{' '}
                  <Link
                    href={`/s/${slug}/services/new`}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Add it as a listing
                  </Link>
                  .
                </>
              ) : (
                <>
                  Type to search, or{' '}
                  <Link
                    href={`/s/${slug}/services/new`}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    add a new listing
                  </Link>
                  .
                </>
              )}
            </p>
          )}

          {results.length > 0 && (
            <ul className="rounded border border-border divide-y divide-border max-h-64 overflow-y-auto">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => link(p)}
                    disabled={saving}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-2 text-left hover:bg-muted/50 transition-colors',
                      linked?.id === p.id && 'bg-muted',
                    )}
                  >
                    <Building2 size={11} className="text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{formatServiceAddress(p)}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{formatServiceFacts(p) || '—'}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

        </div>
      )}
    </div>
  );
}
