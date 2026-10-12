import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChargingContext } from '@/lib/sessionState';

const rpc = vi.fn();
const deleteOfflineCheckIn = vi.fn();
const getOfflineCheckIns = vi.fn();
const refreshChargingContext = vi.fn();
const getCachedChargingContext = vi.fn();
const persistSyncDenials = vi.fn();

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('@/lib/sqlite', () => ({
  deleteOfflineCheckIn: (...a: unknown[]) => deleteOfflineCheckIn(...a),
  getOfflineCheckIns: (...a: unknown[]) => getOfflineCheckIns(...a),
  insertOfflineCheckIn: vi.fn(),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
vi.mock('@/services/sessionCharging', () => ({
  refreshChargingContext: (...a: unknown[]) => refreshChargingContext(...a),
  getCachedChargingContext: (...a: unknown[]) => getCachedChargingContext(...a),
  persistSyncDenials: (...a: unknown[]) => persistSyncDenials(...a),
}));

import { recordCheckIn, syncPendingCheckIns } from './checkin';

const charged: ChargingContext = {
  chargingEnabled: true,
  planType: 'pay_per_session',
  planPrice: 1000,
  planCurrency: 'XAF',
  subscriptionStatus: 'active',
  timezone: 'Africa/Douala',
};
const expired: ChargingContext = { ...charged, subscriptionStatus: 'expired' };
const exempt: ChargingContext = { ...charged, chargingEnabled: false };

beforeEach(() => {
  vi.clearAllMocks();
  refreshChargingContext.mockResolvedValue(null);
  getCachedChargingContext.mockResolvedValue(null);
  persistSyncDenials.mockResolvedValue(true);
});

describe('recordCheckIn', () => {
  it('maps a null result for a charged member to session_required', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    refreshChargingContext.mockResolvedValue(charged);
    expect((await recordCheckIn(null)).status).toBe('session_required');
  });

  it('treats an all-null row (PostgREST 14 NULL composite) as a refusal, not a success', async () => {
    rpc.mockResolvedValue({ data: { id: null, checked_in_at: null, member_id: null }, error: null });
    refreshChargingContext.mockResolvedValue(charged);
    expect((await recordCheckIn(null)).status).toBe('session_required');
  });

  it('returns the price of the context that classified the refusal', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    refreshChargingContext.mockResolvedValue({ ...charged, planPrice: 5000, planCurrency: 'XAF' });
    expect(await recordCheckIn(null)).toEqual({ status: 'session_required', sessionPrice: '5000 XAF' });
  });

  it('classifies from the passed context when the refresh hangs', async () => {
    vi.useFakeTimers();
    try {
      rpc.mockResolvedValue({ data: null, error: null });
      refreshChargingContext.mockReturnValue(new Promise(() => {}));
      const pending = recordCheckIn(charged);
      await vi.advanceTimersByTimeAsync(5000);
      expect((await pending).status).toBe('session_required');
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefers the fresh context over a stale passed one', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    refreshChargingContext.mockResolvedValue(charged);
    expect((await recordCheckIn(expired)).status).toBe('session_required');
  });

  it('falls back to the passed context when refresh fails', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await recordCheckIn(charged)).status).toBe('session_required');
  });

  it('keeps expired for expired and exempt members', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    refreshChargingContext.mockResolvedValue(expired);
    expect((await recordCheckIn(null)).status).toBe('expired');
    refreshChargingContext.mockResolvedValue(exempt);
    expect((await recordCheckIn(null)).status).toBe('expired');
    refreshChargingContext.mockResolvedValue(null);
    expect((await recordCheckIn(null)).status).toBe('expired');
  });

  it('returns success for a non-null row without consulting the context', async () => {
    rpc.mockResolvedValue({ data: { checked_in_at: 't' }, error: null });
    expect(await recordCheckIn(charged)).toEqual({ status: 'success', checkedInAt: 't' });
    expect(refreshChargingContext).not.toHaveBeenCalled();
  });
});

describe('syncPendingCheckIns', () => {
  const record = { id: 'scan-1', scannedAt: '2026-10-12T08:00:00Z' };

  beforeEach(() => {
    getOfflineCheckIns.mockResolvedValue([record]);
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it('persists a denial before deleting the queue row for a charged member', async () => {
    refreshChargingContext.mockResolvedValue(charged);
    const order: string[] = [];
    persistSyncDenials.mockImplementation(async () => {
      order.push('persist');
      return true;
    });
    deleteOfflineCheckIn.mockImplementation(async () => {
      order.push('delete');
    });
    const denials = await syncPendingCheckIns();
    expect(denials).toEqual([{ scanId: 'scan-1', scannedAt: record.scannedAt }]);
    expect(order).toEqual(['persist', 'delete']);
  });

  it('records a denial for an all-null row too', async () => {
    rpc.mockResolvedValue({ data: { id: null, checked_in_at: null }, error: null });
    refreshChargingContext.mockResolvedValue(charged);
    expect(await syncPendingCheckIns()).toEqual([{ scanId: 'scan-1', scannedAt: record.scannedAt }]);
  });

  it('uses the cached context when the online refresh is unavailable', async () => {
    getCachedChargingContext.mockResolvedValue(charged);
    expect(await syncPendingCheckIns()).toHaveLength(1);
  });

  it('records a denial when the charging context is unknown rather than dropping it silently', async () => {
    expect(await syncPendingCheckIns()).toEqual([{ scanId: 'scan-1', scannedAt: record.scannedAt }]);
    expect(persistSyncDenials).toHaveBeenCalled();
    expect(deleteOfflineCheckIn).toHaveBeenCalledWith('scan-1');
  });

  it('records no denial for expired or exempt members but still deletes the row', async () => {
    for (const ctx of [expired, exempt]) {
      vi.clearAllMocks();
      getOfflineCheckIns.mockResolvedValue([record]);
      rpc.mockResolvedValue({ data: null, error: null });
      refreshChargingContext.mockResolvedValue(ctx);
      expect(await syncPendingCheckIns()).toEqual([]);
      expect(persistSyncDenials).not.toHaveBeenCalled();
      expect(deleteOfflineCheckIn).toHaveBeenCalledWith('scan-1');
    }
  });

  it('keeps the queue row when persisting the denial fails', async () => {
    refreshChargingContext.mockResolvedValue(charged);
    persistSyncDenials.mockResolvedValue(false);
    await syncPendingCheckIns();
    expect(deleteOfflineCheckIn).not.toHaveBeenCalled();
  });

  it('shows nothing for a verified scan', async () => {
    refreshChargingContext.mockResolvedValue(charged);
    rpc.mockResolvedValue({ data: { checked_in_at: 't' }, error: null });
    expect(await syncPendingCheckIns()).toEqual([]);
    expect(persistSyncDenials).not.toHaveBeenCalled();
    expect(deleteOfflineCheckIn).toHaveBeenCalledWith('scan-1');
  });
});
