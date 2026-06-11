'use client';

import { usePathname } from 'next/navigation';
import { PageTransition } from '@/components/motion/page-transition';
import { PAGE_MAX } from '@/lib/geometry';
import { cn } from '@/lib/utils';

/**
 * The agency content shell — the agency mirror of `LayoutShell`.
 *
 * Client component so `usePathname()` decides chat-vs-dashboard reliably. The
 * previous agency layout branched on an `x-pathname` HTTP header, which is not
 * reliably set on Vercel — when it missed, the wrong container rendered and
 * content hugged the screen edge. Using the client pathname eliminates that.
 *
 *   - `/agency` (the Koala chat home) → full-height, no padding box, so the
 *     workspace centers its own `max-w-3xl` column (identical to the provider
 *     `/s/[slug]/koala`).
 *   - every other agency page → the same `dashboard-content` padded, centered
 *     container the provider dashboard uses
 *     (`px-4 sm:px-6 md:px-10 lg:px-12 py-5 md:py-7`), so nothing touches the edge.
 */
export function AgencyMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const isChat = pathname === '/agency';

  if (isChat) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background text-foreground pb-[env(safe-area-inset-bottom)] md:pb-0">
        <PageTransition className="flex-1 min-h-0 flex flex-col">{children}</PageTransition>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto flex flex-col bg-background text-foreground">
      <div className={cn('dashboard-content w-full', PAGE_MAX, 'mx-auto min-w-0 px-4 sm:px-6 md:px-10 lg:px-12 py-5 md:py-7 pb-28')}>
        <PageTransition>{children}</PageTransition>
      </div>
    </main>
  );
}
