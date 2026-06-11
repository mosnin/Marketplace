import { AuthPageLayout } from '@/components/auth/auth-page-layout';
import { ThemedSignIn } from '@/components/auth/clerk-sign-in';
import Link from 'next/link';
import type { Metadata } from 'next';
import { BODY_MUTED, QUIET_LINK } from '@/lib/typography';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Agency Sign In — Koala' };

export default async function AgencySignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>;
}) {
  const { redirect_url } = await searchParams;
  const SAFE_PREFIXES = ['/s/', '/agency', '/admin', '/invite/', '/subscribe', '/billing-required', '/authorize'];
  const safeInviteRedirect = redirect_url
    && SAFE_PREFIXES.some(p => redirect_url.startsWith(p))
    && !redirect_url.includes('..')
    ? redirect_url
    : null;
  const postSignInUrl = safeInviteRedirect ?? '/auth/redirect?intent=agency';
  const signUpUrl = safeInviteRedirect
    ? `/sign-up?intent=agency&redirect_url=${encodeURIComponent(safeInviteRedirect)}`
    : '/sign-up?intent=agency';

  return (
    <AuthPageLayout
      variant="agency"
      heading="Welcome back, agency."
    >
      <div className="w-full space-y-4">
        <ThemedSignIn
          routing="path"
          path="/login/agency"
          forceRedirectUrl={postSignInUrl}
          signUpUrl={signUpUrl}
        />
        <p className={cn(BODY_MUTED, 'text-center')}>
          Don&apos;t have an account?{' '}
          <Link href={signUpUrl} className={cn(QUIET_LINK, 'underline underline-offset-4')}>
            Sign up
          </Link>
        </p>
      </div>
    </AuthPageLayout>
  );
}
