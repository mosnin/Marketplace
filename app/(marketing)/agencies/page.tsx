/**
 * `/agencies` — how Koala empowers a real estate agency and its floor.
 *
 * Replaces the old `/teams/*` tree and absorbs its content into one rich,
 * scrolling page that belongs to the rebuilt homepage family (home-kit:
 * Reveal / Stagger / Parallax / Eyebrow, AsciiBlob hero, serif section
 * headlines, light canvas, dark accent bands).
 *
 * The one idea: give every agent on your floor an extra teammate, and give
 * yourself a view of the whole room — leads routed, deals tracked,
 * bottlenecks surfaced, everything in one place instead of six tools.
 *
 * Every capability shown is grounded in real code:
 *   - lead routing / reassignment  → lib/ai-tools/tools/assign-lead-to-provider.ts
 *   - performance rollups          → lib/ai-tools/tools/summarize-provider.ts
 *   - bottlenecks / stalled deals  → find-stuck-deals.ts, pipeline-summary.ts,
 *                                     find-overdue-followups.ts
 *   - deal review / sign-off       → lib/ai-tools/tools/request-deal-review.ts
 *   - roles (Owner/Admin/Member)   → lib/permissions.ts (canManageLeads, etc.)
 *
 * Auth users bounce to their workspace before render (mirrors the homepage).
 * Primary CTA stays the locked home pill → /login/provider?intent=signup.
 * Agencies want a walkthrough, so "Book a demo" → /demo is prominent.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { AgenciesContent } from '@/components/marketing/agencies/agencies-content';

export const metadata = { title: 'For agencies · Koala' };

export default async function AgenciesPage() {
  const { userId } = await auth();
  if (userId) {
    redirect('/auth/redirect?intent=agency');
  }
  return <AgenciesContent />;
}
