import { beforeEach, describe, expect, it, vi } from 'vitest';

const eq = vi.fn();
const chain: Record<string, unknown> = {};
for (const m of ['select', 'is', 'order', 'limit']) chain[m] = vi.fn(() => chain);
chain.eq = (...a: unknown[]) => {
  eq(...a);
  return chain;
};
chain.maybeSingle = vi.fn(async () => ({ data: { id: 'pay-1' }, error: null }));

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => chain } }));

import { getPendingMemberPayment } from './payments';

beforeEach(() => eq.mockClear());

describe('getPendingMemberPayment', () => {
  it("defaults to the 'subscription' purpose", async () => {
    expect(await getPendingMemberPayment('m1')).toEqual({ paymentId: 'pay-1' });
    expect(eq).toHaveBeenCalledWith('purpose', 'subscription');
  });

  it("filters by 'session' when passed", async () => {
    await getPendingMemberPayment('m1', 'session');
    expect(eq).toHaveBeenCalledWith('purpose', 'session');
    expect(eq).not.toHaveBeenCalledWith('purpose', 'subscription');
  });
});
