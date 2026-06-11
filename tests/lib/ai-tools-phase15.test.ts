/**
 * Phase 15 (Phase B) tool catalog — happy + sad path coverage for the 10
 * deal/appointment/service tools. Mock pattern mirrors phase5: a `mockByTable`
 * dictionary maps table name → either {single} or {rows} so chained query
 * shapes resolve to the right data on each .from('Table') call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockByTable: Record<
  string,
  {
    rows?: Array<Record<string, unknown>>;
    error?: { message: string } | null;
    single?: Record<string, unknown> | null;
    count?: number;
  }
> = {};

vi.mock('@/lib/supabase', () => {
  function makeChain(table: string): Record<string, unknown> {
    const override = mockByTable[table];
    const rows = override?.rows ?? [];
    const error = override?.error ?? null;
    const single = override?.single;
    const count = override?.count ?? rows.length;

    const termThen = Promise.resolve({ data: rows, error, count });
    const singleThen = Promise.resolve({ data: single ?? rows[0] ?? null, error });

    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    chain.select = vi.fn(passthrough);
    chain.eq = vi.fn(passthrough);
    chain.is = vi.fn(passthrough);
    chain.in = vi.fn(passthrough);
    chain.neq = vi.fn(passthrough);
    chain.gte = vi.fn(passthrough);
    chain.lte = vi.fn(passthrough);
    chain.or = vi.fn(passthrough);
    chain.not = vi.fn(passthrough);
    chain.order = vi.fn(passthrough);
    chain.limit = vi.fn(passthrough);
    chain.update = vi.fn(passthrough);
    chain.delete = vi.fn(passthrough);
    chain.insert = vi.fn(passthrough);
    chain.maybeSingle = vi.fn(() => singleThen);
    chain.single = vi.fn(() => singleThen);
    chain.abortSignal = vi.fn(() => termThen);
    chain.then = (r: (v: unknown) => unknown, e?: (e: unknown) => unknown) => termThen.then(r, e);
    return chain;
  }
  return { supabase: { from: vi.fn((table: string) => makeChain(table)) } };
});

const { syncContactMock, syncDealMock, deleteContactVectorMock } = vi.hoisted(() => ({
  syncContactMock: vi.fn(async () => undefined),
  syncDealMock: vi.fn(async () => undefined),
  deleteContactVectorMock: vi.fn(async () => undefined),
}));
vi.mock('@/lib/vectorize', () => ({
  syncContact: syncContactMock,
  syncDeal: syncDealMock,
  deleteContactVector: deleteContactVectorMock,
  deleteDealVector: vi.fn(),
}));

import { updateDealValueTool } from '@/lib/ai-tools/tools/update-deal-value';
import { updateDealCloseDateTool, resolveCloseDate } from '@/lib/ai-tools/tools/update-deal-close-date';
import { attachServiceToDealTool } from '@/lib/ai-tools/tools/attach-service-to-deal';
import { rescheduleAppointmentTool } from '@/lib/ai-tools/tools/reschedule-appointment';
import { cancelAppointmentTool } from '@/lib/ai-tools/tools/cancel-appointment';
import { findAppointmentsTool } from '@/lib/ai-tools/tools/find-appointments';
import { updateServiceStatusTool } from '@/lib/ai-tools/tools/update-service-status';
import { noteOnServiceTool } from '@/lib/ai-tools/tools/note-on-service';
import { findServiceTool } from '@/lib/ai-tools/tools/find-service';
import { mergePersonsTool } from '@/lib/ai-tools/tools/merge-persons';
import type { ToolContext } from '@/lib/ai-tools/types';

function makeCtx(): ToolContext {
  return {
    userId: 'user_1',
    space: { id: 'space_1', slug: 'jane', name: 'Jane Realty', ownerId: 'u1' },
    signal: new AbortController().signal,
  };
}

beforeEach(() => {
  mockByTable = {};
  syncContactMock.mockClear();
  syncDealMock.mockClear();
  deleteContactVectorMock.mockClear();
});

// ── update_deal_value ────────────────────────────────────────────────────
describe('updateDealValueTool', () => {
  it('requires approval', () => {
    expect(updateDealValueTool.requiresApproval).toBe(true);
  });

  it('updates the value, logs activity, reindexes', async () => {
    mockByTable = {
      Deal: { single: { id: 'd_1', title: 'Parkside', value: 500_000 } },
    };
    const result = await updateDealValueTool.handler(
      { dealId: 'd_1', newValue: 550_000, why: 'New comps' },
      makeCtx(),
    );
    expect(result.display).toBe('success');
    expect(result.summary).toMatch(/Parkside/);
    expect(result.summary).toMatch(/\$550,000/);
    expect(syncDealMock).toHaveBeenCalledTimes(1);
  });

  it('errors when deal is missing', async () => {
    mockByTable = { Deal: { single: null } };
    const result = await updateDealValueTool.handler(
      { dealId: 'missing', newValue: 100 },
      makeCtx(),
    );
    expect(result.display).toBe('error');
    expect(result.summary).toMatch(/No deal/);
    expect(syncDealMock).not.toHaveBeenCalled();
  });
});

// ── update_deal_close_date ───────────────────────────────────────────────
describe('updateDealCloseDateTool', () => {
  it('requires approval', () => {
    expect(updateDealCloseDateTool.requiresApproval).toBe(true);
  });

  it('resolves "tomorrow" to a valid ISO string', () => {
    const out = resolveCloseDate('tomorrow', new Date('2026-05-01T12:00:00Z'));
    expect(out).not.toBeNull();
    expect(out!.slice(0, 10)).toBe('2026-05-02');
  });

  it('resolves an explicit ISO datetime', () => {
    const out = resolveCloseDate('2026-07-15');
    expect(out).not.toBeNull();
    expect(out!.slice(0, 10)).toBe('2026-07-15');
  });

  it('errors on an unparseable phrase', async () => {
    mockByTable = { Deal: { single: { id: 'd_1', title: 'X', closeDate: null } } };
    const result = await updateDealCloseDateTool.handler(
      { dealId: 'd_1', when: 'sometime soonish' },
      makeCtx(),
    );
    expect(result.display).toBe('error');
    expect(result.summary).toMatch(/Couldn't read/);
  });

  it('updates closeDate when given a valid relative phrase', async () => {
    mockByTable = { Deal: { single: { id: 'd_1', title: 'Parkside', closeDate: null } } };
    const result = await updateDealCloseDateTool.handler(
      { dealId: 'd_1', when: 'in 2 weeks' },
      makeCtx(),
    );
    expect(result.display).toBe('success');
    expect(result.summary).toMatch(/Parkside/);
  });
});

// ── attach_service_to_deal ──────────────────────────────────────────────
describe('attachServiceToDealTool', () => {
  it('requires approval', () => {
    expect(attachServiceToDealTool.requiresApproval).toBe(true);
  });

  it('errors when the service is in a different space (not found)', async () => {
    mockByTable = {
      Deal: { single: { id: 'd_1', title: 'X', serviceId: null } },
      Service: { single: null },
    };
    const result = await attachServiceToDealTool.handler(
      { dealId: 'd_1', serviceId: 'p_other_space' },
      makeCtx(),
    );
    expect(result.display).toBe('error');
    expect(result.summary).toMatch(/No service/);
  });
});

// ── reschedule_appointment ──────────────────────────────────────────────────────
describe('rescheduleAppointmentTool', () => {
  it('requires approval', () => {
    expect(rescheduleAppointmentTool.requiresApproval).toBe(true);
  });

  it('errors when appointment is missing', async () => {
    mockByTable = { Appointment: { single: null } };
    const result = await rescheduleAppointmentTool.handler(
      {
        appointmentId: 'missing',
        newStartsAt: '2026-06-01T15:00:00.000Z',
      },
      makeCtx(),
    );
    expect(result.display).toBe('error');
    expect(result.summary).toMatch(/No appointment/);
  });

  it('reschedules and preserves duration when newEndsAt is omitted', async () => {
    mockByTable = {
      Appointment: {
        single: {
          id: 't_1',
          startsAt: '2026-05-01T14:00:00.000Z',
          endsAt: '2026-05-01T15:00:00.000Z',
          contactId: null,
          serviceAddress: null,
          guestName: 'Sam',
          status: 'scheduled',
        },
      },
    };
    const result = await rescheduleAppointmentTool.handler(
      { appointmentId: 't_1', newStartsAt: '2026-06-01T18:00:00.000Z' },
      makeCtx(),
    );
    expect(result.display).toBe('success');
    const data = result.data as { startsAt: string; endsAt: string };
    expect(new Date(data.endsAt).getTime() - new Date(data.startsAt).getTime()).toBe(60 * 60 * 1000);
  });
});

// ── cancel_appointment ──────────────────────────────────────────────────────────
describe('cancelAppointmentTool', () => {
  it('requires approval', () => {
    expect(cancelAppointmentTool.requiresApproval).toBe(true);
  });

  it('errors when the appointment is missing', async () => {
    mockByTable = { Appointment: { single: null } };
    const result = await cancelAppointmentTool.handler(
      { appointmentId: 'missing', reason: 'guest fell ill' },
      makeCtx(),
    );
    expect(result.display).toBe('error');
    expect(result.summary).toMatch(/No appointment/);
  });

  it('flips status to cancelled and acknowledges the guest', async () => {
    mockByTable = {
      Appointment: {
        single: {
          id: 't_1',
          contactId: null,
          guestName: 'Sam',
          serviceAddress: '123 Main',
          status: 'scheduled',
        },
      },
    };
    const result = await cancelAppointmentTool.handler(
      { appointmentId: 't_1', reason: 'guest fell ill' },
      makeCtx(),
    );
    expect(result.display).toBe('success');
    expect(result.summary).toMatch(/Sam/);
    expect((result.data as { status: string }).status).toBe('cancelled');
  });
});

// ── find_appointments ───────────────────────────────────────────────────────────
describe('findAppointmentsTool', () => {
  it('is read-only', () => {
    expect(findAppointmentsTool.requiresApproval).toBe(false);
  });

  it('returns an empty list cleanly', async () => {
    mockByTable = { Appointment: { rows: [] } };
    const result = await findAppointmentsTool.handler({ status: 'scheduled' }, makeCtx());
    expect(result.summary).toMatch(/No appointments/);
    expect((result.data as { appointments: unknown[] }).appointments).toHaveLength(0);
  });

  it('summarises a list of appointments', async () => {
    mockByTable = {
      Appointment: {
        rows: [
          {
            id: 't_1',
            startsAt: '2026-05-02T14:00:00.000Z',
            endsAt: '2026-05-02T15:00:00.000Z',
            serviceAddress: '123 Main',
            guestName: 'Sam',
            status: 'scheduled',
          },
          {
            id: 't_2',
            startsAt: '2026-05-03T14:00:00.000Z',
            endsAt: '2026-05-03T15:00:00.000Z',
            serviceAddress: '456 Oak',
            guestName: 'Jane',
            status: 'confirmed',
          },
        ],
      },
    };
    const result = await findAppointmentsTool.handler({}, makeCtx());
    expect(result.display).toBe('appointments');
    expect((result.data as { appointments: unknown[] }).appointments).toHaveLength(2);
    expect(result.summary).toMatch(/Sam/);
    expect(result.summary).toMatch(/Jane/);
  });
});

// ── update_service_status ───────────────────────────────────────────────
describe('updateServiceStatusTool', () => {
  it('requires approval', () => {
    expect(updateServiceStatusTool.requiresApproval).toBe(true);
  });

  it('rejects an unknown status at parse time', () => {
    expect(() =>
      updateServiceStatusTool.parameters.parse({ serviceId: 'p_1', newStatus: 'bogus' }),
    ).toThrow();
  });

  it('updates the status and echoes the address', async () => {
    mockByTable = {
      Service: { single: { id: 'p_1', address: '123 Main', listingStatus: 'active' } },
    };
    const result = await updateServiceStatusTool.handler(
      { serviceId: 'p_1', newStatus: 'pending' },
      makeCtx(),
    );
    expect(result.display).toBe('success');
    expect(result.summary).toMatch(/123 Main/);
    expect(result.summary).toMatch(/pending/);
  });
});

// ── note_on_service ─────────────────────────────────────────────────────
describe('noteOnServiceTool', () => {
  it('requires approval', () => {
    expect(noteOnServiceTool.requiresApproval).toBe(true);
  });

  it('errors when service is missing', async () => {
    mockByTable = { Service: { single: null } };
    const result = await noteOnServiceTool.handler(
      { serviceId: 'missing', content: 'hello' },
      makeCtx(),
    );
    expect(result.display).toBe('error');
    expect(result.summary).toMatch(/No service/);
  });

  it('appends a dated note line', async () => {
    mockByTable = {
      Service: { single: { id: 'p_1', address: '123 Main', notes: null } },
    };
    const result = await noteOnServiceTool.handler(
      { serviceId: 'p_1', content: 'Sellers want a quick close' },
      makeCtx(),
    );
    expect(result.display).toBe('success');
    const line = (result.data as { appendedLine: string }).appendedLine;
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}\] Sellers want/);
  });
});

// ── find_service ────────────────────────────────────────────────────────
describe('findServiceTool', () => {
  it('is read-only', () => {
    expect(findServiceTool.requiresApproval).toBe(false);
  });

  it('rejects with no filters', () => {
    expect(() => findServiceTool.parameters.parse({})).toThrow();
  });

  it('returns a single match richly', async () => {
    mockByTable = {
      Service: {
        single: null, // exact-id miss falls through to query
        rows: [
          {
            id: 'p_1',
            address: '123 Main',
            city: 'Brooklyn',
            listingStatus: 'active',
            mlsNumber: 'MLS123',
            listPrice: 750_000,
            beds: 3,
            baths: 2,
            squareFeet: 1500,
          },
        ],
      },
    };
    const result = await findServiceTool.handler({ query: '123 Main' }, makeCtx());
    const data = result.data as { match: string; service?: { address: string } };
    expect(data.match).toBe('single');
    expect(data.service?.address).toBe('123 Main');
  });
});

// ── merge_persons ────────────────────────────────────────────────────────
describe('mergePersonsTool', () => {
  it('requires approval', () => {
    expect(mergePersonsTool.requiresApproval).toBe(true);
  });

  it('rejects keepId === mergeId at parse time', () => {
    expect(() => mergePersonsTool.parameters.parse({ keepId: 'a', mergeId: 'a' })).toThrow();
  });

  it('summariseCall makes the destruction explicit', () => {
    const text = mergePersonsTool.summariseCall!({ keepId: 'jane_chen_1234', mergeId: 'sam_chen_5678' });
    expect(text.toLowerCase()).toContain('delete');
    expect(text).toContain('keep');
  });

  it('errors when the keep contact is missing', async () => {
    // Both lookups go to 'Contact'; we can only return one shape, so the
    // shared mock returns null for both → keep lookup fails first.
    mockByTable = { Contact: { single: null } };
    const result = await mergePersonsTool.handler(
      { keepId: 'k_missing', mergeId: 'm_missing' },
      makeCtx(),
    );
    expect(result.display).toBe('error');
    expect(result.summary).toMatch(/No contact/);
  });
});
