'use client';

/**
 * /s/[slug]/services/new — the standalone create flow for a service offering.
 *
 * A service is a noun (the thing being sold). A deal is a verb (the
 * transaction on it). They earn different shapes; do not conflate. This
 * page is a single form, no wizard ceremony — every field except the name
 * is optional, the form is one screen, the provider is done in 30s.
 *
 * Submit → POST /api/services → navigate to the new service's detail
 * page so the provider can add photos / refine status next.
 */

import { useRouter, useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { H1, TITLE_FONT, BODY_MUTED } from '@/lib/typography';
import { ServiceForm } from '@/components/services/service-form';
import type { Service } from '@/lib/types';

export default function NewServicePage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(values: Partial<Service>) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, ...values }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Couldn't create that service.");
        return;
      }
      const created = (await res.json()) as Service;
      router.push(`/s/${slug}/services/${created.id}`);
    } catch {
      toast.error("Couldn't create that service. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={cn('space-y-6 max-w-2xl mx-auto pb-12')}>
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Services.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          New service
        </h1>
        <p className={cn(BODY_MUTED)}>What offering are you adding?</p>
      </header>

      <ServiceForm
        onCancel={() => router.push(`/s/${slug}/services`)}
        onSubmit={handleSubmit}
        submitting={submitting}
        submitLabel="Create service"
      />
    </div>
  );
}
