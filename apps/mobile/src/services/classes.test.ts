import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { listMyClassBookings } from './classes';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listMyClassBookings', () => {
  it('maps class_cancelled to classCancelled and can_cancel to canCancel', async () => {
    rpc.mockResolvedValue({
      data: [
        { booking_id: 'b1', class_name: 'SPIN', scheduled_at: '2026-12-01T17:00:00+00:00', can_cancel: false, class_cancelled: true },
        { booking_id: 'b2', class_name: 'YOGA', scheduled_at: '2026-12-02T08:00:00+00:00', can_cancel: true, class_cancelled: false },
      ],
      error: null,
    });

    expect(await listMyClassBookings()).toEqual([
      { bookingId: 'b1', className: 'SPIN', scheduledAt: '2026-12-01T17:00:00+00:00', canCancel: false, classCancelled: true },
      { bookingId: 'b2', className: 'YOGA', scheduledAt: '2026-12-02T08:00:00+00:00', canCancel: true, classCancelled: false },
    ]);
    expect(rpc).toHaveBeenCalledWith('list_my_class_bookings');
  });

  it('reads a response without class_cancelled (an older database) as not cancelled', async () => {
    rpc.mockResolvedValue({
      data: [{ booking_id: 'b3', class_name: 'HIIT', scheduled_at: '2026-12-03T17:00:00+00:00', can_cancel: true }],
      error: null,
    });

    const rows = await listMyClassBookings();
    expect(rows?.[0].classCancelled).toBe(false);
  });

  it('is null on an error or a throw, never a partial list', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await listMyClassBookings()).toBeNull();
    rpc.mockRejectedValue(new Error('offline'));
    expect(await listMyClassBookings()).toBeNull();
  });
});
