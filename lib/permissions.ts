/**
 * Central permission helpers for the org/role system.
 *
 * Three account levels:
 *   1. Provider (default) — solo workspace owner
 *   2. Agency — has an AgencyMembership with role agency_owner or agency_admin
 *   3. Platform Admin — User.platformRole = 'admin' (or Clerk metadata fallback)
 *
 * Always use these helpers in API routes, server actions, and layouts.
 * Never scatter raw role checks across the codebase.
 */

import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import type { Agency, AgencyMembership } from '@/lib/types';

// ── Platform admin ────────────────────────────────────────────────────────────

/**
 * Returns true if the current Clerk user is a platform admin.
 * Only check: User.platformRole = 'admin' in DB (single source of truth).
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const session = await auth();
  if (!session.userId) return false;

  // Authoritative check in DB — the single source of truth for admin role
  const { data } = await supabase
    .from('User')
    .select('platformRole, status')
    .eq('clerkId', session.userId)
    .maybeSingle();
  // Same offboarding gate as getAgencyContext()/requireAuth(): an offboarded
  // user loses admin access immediately, not when their Clerk session expires.
  // Resilient to a missing `status` column (pre-BP1a): undefined !== 'offboarded'.
  if ((data as { status?: string } | null)?.status === 'offboarded') return false;
  return data?.platformRole === 'admin';
}

/**
 * Require platform admin access. Throws if not admin.
 * Use at the top of admin route handlers and server components.
 */
export async function requirePlatformAdmin(): Promise<{ clerkUserId: string }> {
  const session = await auth();
  if (!session.userId) throw new Error('Forbidden: not authenticated');

  const ok = await isPlatformAdmin();
  if (!ok) throw new Error('Forbidden: platform admin access required');

  return { clerkUserId: session.userId };
}

// ── Agency ────────────────────────────────────────────────────────────────────

type AgencyContext = {
  agency: Agency;
  membership: AgencyMembership;
  dbUserId: string;
};

/**
 * Returns the agency + membership for the current user if they are an agency
 * (role = agency_owner or agency_admin), or null if they are not.
 */
export async function getAgencyContext(): Promise<AgencyContext | null> {
  const session = await auth();
  if (!session.userId) return null;

  const { data: user } = await supabase
    .from('User')
    .select('id, status')
    .eq('clerkId', session.userId)
    .maybeSingle();
  if (!user) return null;
  // Same offboarding gate as requireAuth(). Agency routes use this helper
  // (or getAgencyMemberContext below) without going through requireAuth,
  // so the gate has to live here too — otherwise an offboarded user's
  // agency-scoped sessions would keep working until their membership row
  // eventually fell out of the DB. Resilient to a missing `status` column
  // pre-BP1a migration: maybeSingle() returns { status: undefined } which
  // is not === 'offboarded'.
  if ((user as { status?: string }).status === 'offboarded') return null;

  // Fetch all agency-level memberships. A user may own one agency and
  // manage another — prefer agency_owner so they always land on their own agency.
  const { data: memberships } = await supabase
    .from('AgencyMembership')
    .select('*')
    .eq('userId', user.id)
    .in('role', ['agency_owner', 'agency_admin'])
    .order('createdAt', { ascending: true });
  if (!memberships?.length) return null;

  // Deterministic pick for a user who is an agency at more than one agency:
  // agency_owner first, then agency_admin, oldest within a tier (query ordered
  // by createdAt). The old `?? memberships[0]` fell back to PostgREST insertion
  // order, so the same user could resolve to a different agency run-to-run
  // and act on the wrong one.
  const membership =
    memberships.find((m) => m.role === 'agency_owner') ??
    memberships.find((m) => m.role === 'agency_admin') ??
    memberships[0];

  const { data: agency } = await supabase
    .from('Agency')
    .select('*')
    .eq('id', membership.agencyId)
    .maybeSingle();
  if (!agency) return null;

  return {
    agency: agency as Agency,
    membership: membership as AgencyMembership,
    dbUserId: user.id,
  };
}

/**
 * Require agency access. Throws if the current user is not an agency.
 */
export async function requireAgency(): Promise<AgencyContext> {
  const ctx = await getAgencyContext();
  if (!ctx) throw new Error('Forbidden: agency access required');
  return ctx;
}

/**
 * Returns the agency + membership for the current user if they have ANY
 * agency membership (including provider_member). Use this for pages that
 * are accessible to all agency members, not just admins/owners.
 */
export async function getAgencyMemberContext(): Promise<AgencyContext | null> {
  const session = await auth();
  if (!session.userId) return null;

  const { data: user } = await supabase
    .from('User')
    .select('id, status')
    .eq('clerkId', session.userId)
    .maybeSingle();
  if (!user) return null;
  // Offboarding gate — see getAgencyContext above for rationale.
  if ((user as { status?: string }).status === 'offboarded') return null;

  const { data: memberships } = await supabase
    .from('AgencyMembership')
    .select('*')
    .eq('userId', user.id)
    .in('role', ['agency_owner', 'agency_admin', 'provider_member'])
    .order('createdAt', { ascending: true });
  if (!memberships?.length) return null;

  // Prefer agency_owner > agency_admin > provider_member, oldest within a tier
  // (query ordered by createdAt) so a multi-agency user resolves
  // deterministically instead of by PostgREST insertion order.
  const membership =
    memberships.find((m) => m.role === 'agency_owner') ??
    memberships.find((m) => m.role === 'agency_admin') ??
    memberships.find((m) => m.role === 'provider_member') ??
    memberships[0];

  const { data: agency } = await supabase
    .from('Agency')
    .select('*')
    .eq('id', membership.agencyId)
    .maybeSingle();
  if (!agency) return null;

  return {
    agency: agency as Agency,
    membership: membership as AgencyMembership,
    dbUserId: user.id,
  };
}

// ── Role-based permission helpers ─────────────────────────────────────────────

/** Roles that can manage leads (assign, reassign, delete) */
const LEAD_MANAGEMENT_ROLES = ['agency_owner', 'agency_admin'] as const;

/** Roles that can edit agency settings */
const SETTINGS_EDIT_ROLES = ['agency_owner', 'agency_admin'] as const;

/** Roles that can manage member roles (promote/demote) */
const ROLE_MANAGEMENT_ROLES = ['agency_owner', 'agency_admin'] as const;

/**
 * Check if an agency membership role can manage leads (assign, reassign).
 * Only agency_owner and agency_admin can assign leads.
 * provider_member can only view leads assigned to them.
 */
export function canManageLeads(role: string): boolean {
  return (LEAD_MANAGEMENT_ROLES as readonly string[]).includes(role);
}

/**
 * Check if an agency membership role can edit agency settings.
 */
export function canEditSettings(role: string): boolean {
  return (SETTINGS_EDIT_ROLES as readonly string[]).includes(role);
}

/**
 * Check if an agency membership role can change other members' roles.
 */
export function canManageRoles(role: string): boolean {
  return (ROLE_MANAGEMENT_ROLES as readonly string[]).includes(role);
}

/**
 * Check if a user with the given role can change the target member's role.
 * - agency_owner can change any non-owner role
 * - agency_admin can promote provider_member to agency_admin, but cannot demote other admins
 */
export function canChangeRole(actorRole: string, targetCurrentRole: string): boolean {
  if (targetCurrentRole === 'agency_owner') return false;
  if (actorRole === 'agency_owner') return true;
  if (actorRole === 'agency_admin' && targetCurrentRole === 'provider_member') return true;
  return false;
}

// ── Shared auth helper ────────────────────────────────────────────────────────

/**
 * Resolve the current Clerk user to their internal User row.
 * Returns null if not authenticated or not in DB.
 */
export async function getCurrentDbUser(): Promise<{ id: string; clerkId: string } | null> {
  const session = await auth();
  if (!session.userId) return null;

  const { data } = await supabase
    .from('User')
    .select('id, clerkId')
    .eq('clerkId', session.userId)
    .maybeSingle();
  return data ?? null;
}
