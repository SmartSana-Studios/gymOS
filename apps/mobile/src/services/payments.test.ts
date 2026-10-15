import { beforeEach, describe, expect, it, vi } from 'vitest';

const eq = vi.fn();
const chain: Record<string, unknown> = {};
for (const m of ['select', 'is', 'order', 'limit']) chain[m] = vi.fn(() => chain);
chain.eq = (...a: unknown[]) => {
  eq(...a);
  return chain;
};
chain.maybeSingle = vi.fn(async () => ({ data: { id: 'pay-1' }, error: null }));

let invokeError: unknown = null;
const rpc = vi.fn();
const invoke = vi.fn(async () => ({ data: null, error: invokeError }));
chain.single = vi.fn(async () => ({ data: { provider: 'taramoney' }, error: null }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => chain,
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) },
  },
}));

import { FunctionsHttpError } from '@supabase/supabase-js';

import { getPendingMemberPayment, initiateMemberPayment, initiateSessionPayment } from './payments';

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

describe('Story 22.4: a 403 permission_denied from the edge initiate route', () => {
  beforeEach(() => {
    invokeError = new FunctionsHttpError({
      json: async () => ({ error: 'forbidden', code: 'permission_denied' }),
    });
    rpc.mockReset();
  });

  it('initiateMemberPayment returns the permission_denied code, not the generic error', async () => {
    rpc.mockResolvedValue({ data: 'pay-1', error: null });
    expect(await initiateMemberPayment('+237680811041')).toEqual({ paymentId: null, code: 'permission_denied' });
  });

  it('initiateSessionPayment returns the permission_denied code, not the generic error', async () => {
    rpc.mockResolvedValue({ data: [{ payment_id: 'pay-2', provider_key: 'taramoney' }], error: null });
    expect(await initiateSessionPayment('+237680811041')).toEqual({ paymentId: null, code: 'permission_denied' });
  });
});
