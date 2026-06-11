'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, Check, Plus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { EASE_APPLE } from '@/lib/motion';
import type { Service } from '@/lib/types';
import { formatServiceAddress, formatServiceFacts } from '@/lib/services';
import { formatCurrency } from '@/lib/formatting';

interface WizardStepDetailsProps {
  slug: string;
  title: string;
  onTitleChange: (v: string) => void;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  onPriorityChange: (v: 'LOW' | 'MEDIUM' | 'HIGH') => void;
  value: string;
  onValueChange: (v: string) => void;
  commissionRate: string;
  onCommissionRateChange: (v: string) => void;
  probability: string;
  onProbabilityChange: (v: string) => void;
  closeDate: string;
  onCloseDateChange: (v: string) => void;
  address: string;
  onAddressChange: (v: string) => void;
  serviceId: string | null;
  onServiceChange: (service: Service | null) => void;
  titleError?: string;
}

type ServiceMode = 'pick' | 'new';

export function WizardStepDetails({
  slug,
  title,
  onTitleChange,
  priority,
  onPriorityChange,
  value,
  onValueChange,
  commissionRate,
  onCommissionRateChange,
  probability,
  onProbabilityChange,
  closeDate,
  onCloseDateChange,
  address,
  onAddressChange,
  serviceId,
  onServiceChange,
  titleError,
}: WizardStepDetailsProps) {
  // Initial workspace check: are there any services at all? A day-one
  // workspace doesn't need a picker that can't return anything — just drop
  // the provider into the address field.
  const [hasAnyServices, setHasAnyServices] = useState<boolean | null>(null);
  const [mode, setMode] = useState<ServiceMode>('pick');
  const [selected, setSelected] = useState<Service | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Service[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialCheckDoneRef = useRef(false);

  // One-time workspace check on mount.
  useEffect(() => {
    if (initialCheckDoneRef.current) return;
    initialCheckDoneRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/services?slug=${encodeURIComponent(slug)}`);
        if (!res.ok) {
          if (!cancelled) {
            setHasAnyServices(false);
            setMode('new');
          }
          return;
        }
        const data = (await res.json()) as Service[];
        if (cancelled) return;
        const any = Array.isArray(data) && data.length > 0;
        setHasAnyServices(any);
        if (!any) setMode('new');
        // Seed results so the provider sees their workspace on landing.
        if (any) setResults(data.slice(0, 8));
      } catch {
        if (!cancelled) {
          setHasAnyServices(false);
          setMode('new');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Debounced search against /api/services when the provider types.
  const search = useCallback(
    async (q: string) => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/services?slug=${encodeURIComponent(slug)}&search=${encodeURIComponent(q)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as Service[];
          setResults(Array.isArray(data) ? data.slice(0, 20) : []);
        }
      } finally {
        setSearching(false);
      }
    },
    [slug],
  );

  useEffect(() => {
    if (mode !== 'pick' || hasAnyServices === false) return;
    // Empty query: don't refire — we already seeded the workspace list.
    if (!query.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      search(query);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mode, hasAnyServices, search]);

  function pickService(p: Service) {
    setSelected(p);
    onServiceChange(p);
  }

  function clearSelection() {
    setSelected(null);
    onServiceChange(null);
  }

  function switchToNew() {
    setSelected(null);
    onServiceChange(null);
    setMode('new');
  }

  function switchToPick() {
    onAddressChange('');
    setMode('pick');
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Deal details</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Give this deal a title and link it to a service.
        </p>
      </div>

      {/* Title */}
      <div className="space-y-1.5">
        <Label htmlFor="wizard-title">
          Title <span className="text-destructive">*</span>
        </Label>
        <Input
          id="wizard-title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="e.g. 123 Maple St – Rental"
          aria-invalid={!!titleError}
        />
        {titleError && (
          <p className="text-xs text-destructive">{titleError}</p>
        )}
      </div>

      {/* Priority */}
      <div className="space-y-1.5">
        <Label>Priority</Label>
        <Select value={priority} onValueChange={(v) => onPriorityChange(v as 'LOW' | 'MEDIUM' | 'HIGH')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="LOW">Low</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Numeric fields — 2-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="wizard-value">Deal Value ($)</Label>
          <Input
            id="wizard-value"
            type="number"
            min={0}
            step={1000}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder="e.g. 500000"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wizard-commission">Commission Rate (%)</Label>
          <Input
            id="wizard-commission"
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={commissionRate}
            onChange={(e) => onCommissionRateChange(e.target.value)}
            placeholder="e.g. 2.5"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wizard-probability">Close Probability (%)</Label>
          <Input
            id="wizard-probability"
            type="number"
            min={0}
            max={100}
            step={1}
            value={probability}
            onChange={(e) => onProbabilityChange(e.target.value)}
            placeholder="e.g. 75"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wizard-close-date">Expected Close Date</Label>
          <Input
            id="wizard-close-date"
            type="date"
            value={closeDate}
            onChange={(e) => onCloseDateChange(e.target.value)}
          />
        </div>
      </div>

      {/* Service — picker (default) or new-address (fallback) */}
      <div className="space-y-2">
        <Label>Service</Label>

        {/* Wait for the workspace check before showing either UI — a day-one
            workspace would flash the picker for a frame before swapping to
            the address field. Calm silence beats a flicker. */}
        {hasAnyServices === null && (
          <div className="h-9" aria-hidden />
        )}

        {hasAnyServices !== null && mode === 'pick' && hasAnyServices !== false && (
          <div className="space-y-3">
            {selected ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-background flex items-center justify-center text-muted-foreground flex-shrink-0">
                  <Building2 size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{formatServiceAddress(selected)}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[
                      formatServiceFacts(selected),
                      selected.listPrice != null ? formatCurrency(selected.listPrice) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search
                    size={13}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Service address, city, or MLS#…"
                    className="pl-8 text-sm"
                  />
                </div>

                {searching && (
                  <p className="text-xs text-muted-foreground">Searching…</p>
                )}

                {!searching && query.trim() && results.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No matches in your workspace.
                  </p>
                )}

                {results.length > 0 && (
                  // Re-key on the query so every debounced search re-mounts
                  // the list and replays the row entrance. Without this the
                  // existing nodes would just swap content with no motion —
                  // the provider wouldn't feel that new results arrived.
                  <ul
                    key={`results-${query}`}
                    className="rounded-md border border-border divide-y divide-border max-h-72 overflow-y-auto"
                  >
                    {results.map((p, idx) => {
                      const isSelected = serviceId === p.id;
                      // Stagger first 8 rows; past that, instant — a long
                      // result list shouldn't choreograph the whole popup.
                      const delay = idx < 8 ? idx * 0.025 : 0;
                      return (
                        <motion.li
                          key={p.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, ease: EASE_APPLE, delay }}
                        >
                          <button
                            type="button"
                            onClick={() => pickService(p)}
                            className={cn(
                              'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/60',
                              isSelected && 'bg-primary/5',
                            )}
                          >
                            <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0">
                              <Building2 size={13} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium leading-tight truncate">
                                {formatServiceAddress(p)}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {[
                                  formatServiceFacts(p),
                                  p.listPrice != null ? formatCurrency(p.listPrice) : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || '—'}
                              </p>
                            </div>
                            {isSelected ? (
                              <Check size={15} className="flex-shrink-0 text-primary" />
                            ) : (
                              <Plus size={15} className="flex-shrink-0 text-muted-foreground" />
                            )}
                          </button>
                        </motion.li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}

            {!selected && (
              <button
                type="button"
                onClick={switchToNew}
                className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
              >
                Don&apos;t see it? Add a new service →
              </button>
            )}
          </div>
        )}

        {hasAnyServices !== null && (mode === 'new' || hasAnyServices === false) && (
          <div className="space-y-2">
            <Input
              id="wizard-address"
              value={address}
              onChange={(e) => onAddressChange(e.target.value)}
              placeholder="e.g. 456 Oak Ave, Toronto, ON"
              autoFocus={mode === 'new'}
            />
            {hasAnyServices !== false && (
              <button
                type="button"
                onClick={switchToPick}
                className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
              >
                ← Pick from an existing service instead
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
