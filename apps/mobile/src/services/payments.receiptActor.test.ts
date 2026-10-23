/**
 * Story 23.8 (FR-195): a receipt for a payment GymOS support recorded shows the gym, never a person and never "GymOS Support" as a person.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const REAL = { id: '00000000-0000-0000-0000-000000238101', name: 'Zed Realperson', email: 'zed.realperson@gymosapps.com' };
const PROXY = '00000000-0000-0000-0000-0000000000aa';
const STAFF = '00000000-0000-0000-0000-0000000000bb';

let paymentRow: Record<string, unknown>;
let memberRow: { name: string } | null;
let proxyId: unknown;
const tables: string[] = [];
const rpcs: string[] = [];

function chainFor(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is']) chain[m] = vi.fn(() => chain);
  chain.single = vi.fn(async () => ({ data: paymentRow, error: null }));
  chain.maybeSingle = vi.fn(async () => ({ data: table === 'members' ? memberRow : null, error: null }));
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      tables.push(table);
      return chainFor(table);
    },
    rpc: async (fn: string) => {
      rpcs.push(fn);
      return { data: proxyId, error: null };
    },
    functions: { invoke: vi.fn() },
  },
}));

import { getPaymentReceipt } from './payments';

function payment(actorId: string | null) {
  return {
    id: 'pay-1', amount: 2000, currency: 'XAF', method: 'cash', status: 'verified', created_at: '2026-10-20T10:00:00Z',
    provider_transaction_ref: null, actor_id: actorId, subscription_id: null, purpose: 'subscription', subscriptions: null,
  };
}

beforeEach(() => {
  tables.length = 0;
  rpcs.length = 0;
  memberRow = null;
  proxyId = PROXY;
});

describe('getPaymentReceipt recorded-by', () => {
  it('shows the gym for a support-recorded payment', async () => {
    paymentRow = payment(PROXY);
    const receipt = await getPaymentReceipt('pay-1', 'm1', 'gym-1', 'Gina', 'Iron Gym');
    expect(receipt?.actorName).toBe('Iron Gym');
    expect(rpcs).toEqual(['get_gym_support_proxy_id']);
    const text = JSON.stringify(receipt);
    expect(text).not.toContain('GymOS Support');
    for (const needle of [REAL.id, REAL.name, REAL.email]) expect(text).not.toContain(needle);
    for (const table of ['users', 'support_action_identity', 'support_assignments']) expect(tables).not.toContain(table);
  });

  it('keeps a staff member by name and does not ask for the proxy', async () => {
    paymentRow = payment(STAFF);
    memberRow = { name: 'Staff Sam' };
    const receipt = await getPaymentReceipt('pay-1', 'm1', 'gym-1', 'Gina', 'Iron Gym');
    expect(receipt?.actorName).toBe('Staff Sam');
    expect(rpcs).toEqual([]);
  });

  it('leaves an unknown actor blank (not the gym) when it is not the proxy', async () => {
    paymentRow = payment(REAL.id);
    const receipt = await getPaymentReceipt('pay-1', 'm1', 'gym-1', 'Gina', 'Iron Gym');
    expect(receipt?.actorName).toBeNull();
  });

  it('leaves a payment with no actor blank', async () => {
    paymentRow = payment(null);
    const receipt = await getPaymentReceipt('pay-1', 'm1', 'gym-1', 'Gina', 'Iron Gym');
    expect(receipt?.actorName).toBeNull();
    expect(rpcs).toEqual([]);
  });
});
