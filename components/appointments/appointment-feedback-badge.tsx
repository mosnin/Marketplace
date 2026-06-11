'use client';

import { useState, useEffect } from 'react';
import { Star, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppointmentFeedbackBadgeProps {
  appointmentId: string;
  slug: string;
  status: string;
}

export function AppointmentFeedbackBadge({ appointmentId, slug, status }: AppointmentFeedbackBadgeProps) {
  const [feedback, setFeedback] = useState<{ rating: number; comment: string | null } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (status !== 'completed') return;
    fetch(`/api/appointments/feedback?slug=${slug}&appointmentId=${appointmentId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.rating) setFeedback(data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [appointmentId, slug, status]);

  if (status !== 'completed' || !loaded) return null;
  if (!feedback) return null;

  return (
    <div className="flex items-center gap-0.5" title={feedback.comment || `${feedback.rating}/5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={10}
          className={cn(
            i < feedback.rating ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/20'
          )}
        />
      ))}
    </div>
  );
}
