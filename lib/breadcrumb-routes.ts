export type BreadcrumbRoute = {
  label: string;
  /** exact: true means pathname must equal the path exactly */
  exact?: boolean;
};

/** Maps route prefixes to display labels, ordered from most-specific to least-specific */
export const BREADCRUMB_ROUTES: Array<{ path: string; label: string; exact?: boolean }> = [
  // Agent/provider routes
  { path: '/contacts/', label: 'Contacts' },
  { path: '/contacts', label: 'Contacts', exact: true },
  { path: '/leads', label: 'Leads', exact: true },
  { path: '/leads/', label: 'Leads' },
  { path: '/deals', label: 'Pipeline' },
  { path: '/calendar', label: 'Calendar' },
  { path: '/analytics', label: 'Analytics' },
  { path: '/activity', label: 'Activity' },
  { path: '/settings/agency-setup', label: 'Agency' },
  { path: '/settings', label: 'Settings' },
  { path: '/koala', label: 'Koala' },
  { path: '/team', label: 'Team' },
  { path: '/profile', label: 'Profile' },
  // Agency routes
  { path: '/agency/brief', label: 'Brief' },
  { path: '/agency/forecast', label: 'Forecast' },
  { path: '/agency/people', label: 'People' },
  { path: '/agency/deals', label: 'Deals' },
  { path: '/agency/services', label: 'Services' },
  { path: '/agency/integrations', label: 'Integrations' },
  { path: '/agency/usage', label: 'Usage' },
  { path: '/agency/providers', label: 'Providers' },
  { path: '/agency/members', label: 'Members' },
  { path: '/agency/leads', label: 'Leads' },
  { path: '/agency/analytics', label: 'Analytics' },
  { path: '/agency/agent-activity', label: 'Agent activity' },
  { path: '/agency/activity', label: 'Activity' },
  { path: '/agency/reviews', label: 'Reviews' },
  { path: '/agency/templates', label: 'Templates' },
  { path: '/agency/leaderboard', label: 'Leaderboard' },
  { path: '/agency/billing', label: 'Billing' },
  { path: '/agency/invitations', label: 'Invitations' },
  { path: '/agency/settings/form-builder', label: 'Form Builder' },
  { path: '/agency/settings/auto-assignment', label: 'Auto-assignment' },
  { path: '/agency/settings/routing-rules', label: 'Routing rules' },
  { path: '/agency/settings/mcp', label: 'MCP' },
  { path: '/agency/settings/profile', label: 'Profile' },
  { path: '/agency/settings', label: 'Settings' },
  { path: '/agency', label: 'Koala', exact: true },
];

/**
 * Returns the breadcrumb label for a given pathname and optional base path.
 * Tries to match from most-specific (longest path) to least-specific.
 */
export function getBreadcrumbLabel(pathname: string, base = ''): string {
  const relative = base ? pathname.replace(base, '') || '/' : pathname;

  // Sort by path length descending so longest (most specific) matches first
  const sorted = [...BREADCRUMB_ROUTES].sort((a, b) => b.path.length - a.path.length);

  for (const route of sorted) {
    if (route.exact) {
      if (relative === route.path || pathname === route.path) return route.label;
    } else {
      if (relative.startsWith(route.path) || pathname.startsWith(route.path)) return route.label;
    }
  }

  return 'Dashboard';
}
