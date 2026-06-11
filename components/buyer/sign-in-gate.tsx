'use client';

/**
 * Signed-out gate for the buyer area.
 *
 * Buyers authenticate with the SAME Clerk instance as providers, so the gate
 * routes them through the existing sign-in. We use Clerk's <SignInButton> with
 * `forceRedirectUrl="/buyer"` so the buyer lands back in their dashboard after
 * authenticating — Clerk applies this redirect from its own flow, so it works
 * even though the shared /sign-in page's internal default targets the provider
 * workspace. A plain link to /sign-in is offered as a secondary path.
 *
 * Visual: paper-flat, neutral, the empty-state vocabulary. Calm welcome, not a
 * pitch — the marketplace does the pitch (STYLESHEET.md, auth section).
 */

import { SignInButton } from '@clerk/nextjs';
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { H1, TITLE_FONT, BODY_MUTED, PRIMARY_PILL, QUIET_LINK } from '@/lib/typography';

export function BuyerSignInGate() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/[0.04]">
          <ShoppingBag size={20} strokeWidth={1.75} className="text-muted-foreground" aria-hidden />
        </div>
        <p className={cn(BODY_MUTED)}>Your purchases.</p>
        <h1 className={cn(H1, 'mt-1')} style={TITLE_FONT}>
          Sign in to Koala
        </h1>
        <p className={cn(BODY_MUTED, 'mt-2 max-w-sm')}>
          Track your bookings and purchases from the providers you work with.
          Sign in to pick up where you left off.
        </p>

        <div className="mt-6 flex flex-col items-center gap-3">
          <SignInButton mode="redirect" forceRedirectUrl="/buyer" signUpForceRedirectUrl="/buyer">
            <button type="button" className={cn(PRIMARY_PILL)}>
              Sign in
            </button>
          </SignInButton>
          <Link
            href="/sign-in?redirect_url=/buyer"
            className={cn(QUIET_LINK, 'underline underline-offset-4')}
          >
            Go to sign-in
          </Link>
        </div>

        <p className={cn('mt-8 text-xs', BODY_MUTED)}>
          Just browsing?{' '}
          <a
            href="/marketplace"
            className={cn(QUIET_LINK, 'underline underline-offset-4')}
          >
            Explore the marketplace
          </a>
        </p>
      </div>
    </div>
  );
}
