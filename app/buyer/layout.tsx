import { auth } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { BuyerShell } from '@/components/buyer/buyer-shell';
import { BuyerSignInGate } from '@/components/buyer/sign-in-gate';

export const metadata: Metadata = {
  title: 'Your purchases — Koala',
};

/**
 * Buyer area layout. Buyers sign in with the same Clerk instance as providers.
 *
 * Signed-out users get a friendly in-place sign-in gate (rather than a hard
 * middleware bounce) so the buyer's first impression is a calm welcome that
 * routes them back to /buyer after authenticating. Signed-in users get the
 * buyer top-nav shell. The /api/buyer routes are hard-protected in
 * middleware.ts, so data access is always behind Clerk regardless of this UI.
 */
export default async function BuyerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  if (!userId) {
    return <BuyerSignInGate />;
  }

  return <BuyerShell>{children}</BuyerShell>;
}
