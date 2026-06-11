/**
 * CategoryGrid — the eight consumer categories as a tappable grid.
 * Each tile links to /marketplace/category/[slug]. Used on the browse page
 * and reusable elsewhere. Each category gets a lucide glyph so the grid scans
 * as a set of doors rather than a wall of text.
 */

import Link from 'next/link';
import {
  Scissors,
  Dumbbell,
  Compass,
  Camera,
  GraduationCap,
  HeartPulse,
  Briefcase,
  Home,
  type LucideIcon,
} from 'lucide-react';
import { MARKETPLACE_CATEGORIES } from './marketplace-data';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'hair-beauty': Scissors,
  fitness: Dumbbell,
  coaching: Compass,
  photography: Camera,
  tutoring: GraduationCap,
  wellness: HeartPulse,
  consulting: Briefcase,
  'home-services': Home,
};

export function CategoryGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {MARKETPLACE_CATEGORIES.map((category) => {
        const Icon = CATEGORY_ICONS[category.slug] ?? Briefcase;
        return (
          <Link
            key={category.slug}
            href={`/marketplace/category/${category.slug}`}
            className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-md hover:shadow-black/5"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand transition-colors">
              <Icon size={18} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{category.label}</p>
              <p className="truncate text-xs text-muted-foreground">{category.blurb}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
