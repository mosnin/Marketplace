/**
 * Unit tests for the provider / agency conversation isolation predicates.
 *
 * These are pure functions with no I/O, so the surface to cover is the
 * boundary itself: which conversations a provider surface may serve and which
 * it must refuse. If someone weakens `isProviderConversation` (drops the
 * spaceId check, drops a prefix), these assertions fail.
 */

import { describe, it, expect } from 'vitest';
import {
  AGENCY_TITLE_PREFIX,
  TEAM_TITLE_PREFIX,
  RESERVED_TITLE_PREFIXES,
  RESERVED_TITLE_LIKE_PATTERNS,
  isReservedConversationTitle,
  isProviderConversation,
} from '@/lib/chat/conversation-access';

const SPACE = 'space_provider_1';
const OTHER_SPACE = 'space_provider_2';

describe('reserved title constants', () => {
  it('pins the exact agency and team prefixes the agency side writes', () => {
    expect(AGENCY_TITLE_PREFIX).toBe('[AGENCY_KOALA]');
    expect(TEAM_TITLE_PREFIX).toBe('[AGENCY_CHAT]');
    expect(RESERVED_TITLE_PREFIXES).toEqual(['[AGENCY_KOALA]', '[AGENCY_CHAT]']);
  });

  it('derives SQL LIKE patterns from the prefixes', () => {
    expect(RESERVED_TITLE_LIKE_PATTERNS).toEqual(['[AGENCY_KOALA]%', '[AGENCY_CHAT]%']);
  });
});

describe('isReservedConversationTitle', () => {
  it('flags agency-prefixed titles', () => {
    expect(isReservedConversationTitle('[AGENCY_KOALA] my notes')).toBe(true);
    expect(isReservedConversationTitle('[AGENCY_KOALA]')).toBe(true);
  });

  it('flags team-prefixed titles', () => {
    expect(isReservedConversationTitle('[AGENCY_CHAT] standup')).toBe(true);
    expect(isReservedConversationTitle('[AGENCY_CHAT]')).toBe(true);
  });

  it('passes plain provider titles', () => {
    expect(isReservedConversationTitle('Follow up with the Garcias')).toBe(false);
    expect(isReservedConversationTitle('New conversation')).toBe(false);
  });

  it('only matches at the START of the title, never mid-string', () => {
    // A provider could legitimately type the literal text later in a title.
    // Only a leading prefix is reserved.
    expect(isReservedConversationTitle('re: [AGENCY_KOALA] question')).toBe(false);
    expect(isReservedConversationTitle('about [AGENCY_CHAT]')).toBe(false);
  });

  it('treats null / undefined / empty as not reserved', () => {
    expect(isReservedConversationTitle(null)).toBe(false);
    expect(isReservedConversationTitle(undefined)).toBe(false);
    expect(isReservedConversationTitle('')).toBe(false);
  });
});

describe('isProviderConversation', () => {
  it('passes a provider-owned conversation in the right space', () => {
    expect(
      isProviderConversation({ spaceId: SPACE, title: 'Follow up with the Garcias' }, SPACE),
    ).toBe(true);
  });

  it('fails when the conversation belongs to a DIFFERENT space', () => {
    // Wrong space is a cross-tenant attempt even with an innocent title.
    expect(
      isProviderConversation({ spaceId: OTHER_SPACE, title: 'Follow up' }, SPACE),
    ).toBe(false);
  });

  it('fails a agency-prefixed conversation even when the space matches', () => {
    // The agency_owner owns this provider space too, so spaceId matches.
    // The prefix is the only thing standing between the provider and the
    // agency's private Koala history.
    expect(
      isProviderConversation({ spaceId: SPACE, title: '[AGENCY_KOALA] private' }, SPACE),
    ).toBe(false);
  });

  it('fails a team-prefixed conversation even when the space matches', () => {
    expect(
      isProviderConversation({ spaceId: SPACE, title: '[AGENCY_CHAT] team room' }, SPACE),
    ).toBe(false);
  });

  it('fails a agency-prefixed conversation in a foreign space (both gates trip)', () => {
    expect(
      isProviderConversation({ spaceId: OTHER_SPACE, title: '[AGENCY_KOALA] x' }, SPACE),
    ).toBe(false);
  });

  it('fails null / undefined (no conversation row)', () => {
    expect(isProviderConversation(null, SPACE)).toBe(false);
    expect(isProviderConversation(undefined, SPACE)).toBe(false);
  });
});
