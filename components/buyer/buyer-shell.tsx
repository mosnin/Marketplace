'use client';

/**
 * Buyer shell — the top-nav chrome wrapping every signed-in /buyer page.
 *
 * Buyers have a far thinner surface than providers (Dashboard, Purchases, and
 * an outbound link to the marketplace), so this is a calm top-nav rather than
 * the dense provider sidebar. It still speaks the product's vocabulary:
 * hairline border, foreground active rail under the active tab (the sliding
 * 2px underline via motion.layoutId, the app's one "active tab" move), neutral
 * everything, no orange.
 *
 * Active state is computed from usePathname() so it always reflects the real
 * route. "Browse marketplace" is a plain outbound link (the marketplace is
 * built by another team and lives outside /buyer) — never an active tab.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { UserButton } from '@clerk/nextjs';
import { LayoutDashboard, ShoppingBag, Store } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DURATION_BASE, EASE_OUT } from '@/lib/motion';

const NAV = [
  { href: '/buyer', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/buyer/purchases', label: 'Purchases', icon: ShoppingBag, exact: false },
] as const;

function isActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BuyerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link
              href="/buyer"
              className="text-sm font-semibold tracking-tight text-foreground"
            >
              Koala
            </Link>
            <nav className="flex items-center gap-1">
              {NAV.map((item) => {
                const active = isActive(pathname, item.href, item.exact);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors',
                      active
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                    )}
                  >
                    <Icon size={15} aria-hidden />
                    {item.label}
                    {active && (
                      <motion.span
                        layoutId="buyer-nav-underline"
                        className="absolute inset-x-2 -bottom-[11px] h-[2px] rounded-full bg-foreground"
                        transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
                      />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/marketplace"
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
            >
              <Store size={15} aria-hidden />
              <span className="hidden sm:inline">Browse marketplace</span>
            </a>
            <UserButton afterSignOutUrl="/marketplace" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
