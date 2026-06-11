'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  BODY_MUTED,
  CAPTION,
  PRIMARY_PILL,
} from '@/lib/typography';

interface IntakeTrustSignalsFormProps {
  licenseNumber: string;
  fairHousingNotice: string;
  showEqualHousingMark: boolean;
  isOwner: boolean;
}

const FAIR_HOUSING_PLACEHOLDER =
  'We are committed to equal opportunity and do not discriminate on the basis of race, color, religion, national origin, sex, or disability.';

/**
 * Agency-level intake trust signals — set once by the agency admin
 * and inherited by every agent's /apply/b/[agencyId] intake footer.
 * If both per-space and per-agency values exist, the agency value
 * wins on the agency variant.
 */
export function AgencyIntakeTrustSignalsForm({
  licenseNumber: initialLicense,
  fairHousingNotice: initialNotice,
  showEqualHousingMark: initialShow,
  isOwner,
}: IntakeTrustSignalsFormProps) {
  const [licenseNumber, setLicenseNumber] = useState(initialLicense);
  const [fairHousingNotice, setFairHousingNotice] = useState(initialNotice);
  const [showEqualHousingMark, setShowEqualHousingMark] = useState(initialShow);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner) return;
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch('/api/agency/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agencyLicenseNumber: licenseNumber.trim() || null,
          agencyFairHousingNotice: fairHousingNotice || null,
          agencyShowEqualHousingMark: showEqualHousingMark,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaved(true);
        toast.success('Trust signals saved.');
        setTimeout(() => setSaved(false), 2000);
      } else {
        toast.error(data.error ?? 'Failed to save.');
      }
    } catch {
      toast.error('Network error.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="agencyLicenseNumber">License number</Label>
        <Input
          id="agencyLicenseNumber"
          value={licenseNumber}
          onChange={(e) => setLicenseNumber(e.target.value)}
          placeholder="TX-RE-12345"
          maxLength={200}
          disabled={!isOwner}
        />
        <p className={CAPTION}>Your agency license number, shown verbatim.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="agencyFairHousingNotice">Compliance notice</Label>
        <Textarea
          id="agencyFairHousingNotice"
          value={fairHousingNotice}
          onChange={(e) => setFairHousingNotice(e.target.value)}
          placeholder={FAIR_HOUSING_PLACEHOLDER}
          rows={4}
          maxLength={2000}
          disabled={!isOwner}
        />
        <p className={CAPTION}>Plain text. Line breaks are preserved.</p>
      </div>

      <div className="flex items-start gap-3 pt-1">
        <Switch
          id="agencyShowEqualHousingMark"
          checked={showEqualHousingMark}
          onCheckedChange={setShowEqualHousingMark}
          disabled={!isOwner}
        />
        <div className="space-y-0.5">
          <Label
            htmlFor="agencyShowEqualHousingMark"
            className="cursor-pointer"
          >
            Show Equal Housing mark
          </Label>
          <p className={CAPTION}>Displays the standard Equal Housing Opportunity logo.</p>
        </div>
      </div>

      {isOwner && (
        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className={cn(PRIMARY_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
          >
            {saving ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Saving…
              </>
            ) : saved ? (
              <>
                <CheckCircle2 size={13} /> Saved
              </>
            ) : (
              'Save changes'
            )}
          </button>
        </div>
      )}

      {!isOwner && (
        <p className={BODY_MUTED}>
          Only the agency owner or admins can edit these settings.
        </p>
      )}
    </form>
  );
}
