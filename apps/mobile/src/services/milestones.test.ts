import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } }));

import { acknowledgeMilestone, getGymBranding } from './milestones';

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe('acknowledgeMilestone', () => {
  it('sends only the milestone number (no member id) and succeeds', async () => {
    rpc.mockResolvedValue({ data: 30, error: null });
    expect(await acknowledgeMilestone(30)).toEqual({ status: 'success' });
    expect(rpc).toHaveBeenCalledWith('acknowledge_milestone', { p_milestone: 30 });
  });

  it('a null answer (the member does not hold it) is still a success: nothing to acknowledge', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await acknowledgeMilestone(7)).toEqual({ status: 'success' });
  });

  it('a suspended gym (42501, is not active) is gym_suspended', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied: gym 1 is not active' } });
    expect(await acknowledgeMilestone(7)).toEqual({ status: 'gym_suspended' });
  });

  it.each(['42501', '22023'])('a %s refusal is not retryable', async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'permission denied' } });
    expect(await acknowledgeMilestone(7)).toEqual({ status: 'error', retryable: false });
  });

  it('any other error is retryable', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'Failed to fetch' } });
    expect(await acknowledgeMilestone(7)).toEqual({ status: 'error', retryable: true });
  });

  it('never throws', async () => {
    rpc.mockRejectedValue(new Error('offline'));
    expect(await acknowledgeMilestone(100)).toEqual({ status: 'error', retryable: true });
  });
});

describe('getGymBranding', () => {
  function chain(result: unknown) {
    const maybeSingle = vi.fn().mockResolvedValue(result);
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });
    return { select, eq };
  }

  it('reads the name and logo of the gym named by id (never an unfiltered read)', async () => {
    const { select, eq } = chain({ data: { name: 'Iron Gym', logo_url: 'https://x/logo.png' }, error: null });
    expect(await getGymBranding('gym-a')).toEqual({ name: 'Iron Gym', logoUrl: 'https://x/logo.png' });
    expect(from).toHaveBeenCalledWith('gyms');
    expect(select).toHaveBeenCalledWith('name, logo_url');
    expect(eq).toHaveBeenCalledWith('id', 'gym-a');
  });

  it('no logo is null', async () => {
    chain({ data: { name: 'Plain Gym', logo_url: null }, error: null });
    expect(await getGymBranding('gym-b')).toEqual({ name: 'Plain Gym', logoUrl: null });
  });

  it('a failed read omits the logo and falls back to the last good name of that gym, else null', async () => {
    chain({ data: { name: 'Iron Gym', logo_url: 'https://x/logo.png' }, error: null });
    await getGymBranding('gym-c');
    chain({ data: null, error: { message: 'boom' } });
    expect(await getGymBranding('gym-c')).toEqual({ name: 'Iron Gym', logoUrl: null });
    expect(await getGymBranding('gym-never-read')).toEqual({ name: null, logoUrl: null });
  });

  it('never throws', async () => {
    from.mockImplementation(() => {
      throw new Error('offline');
    });
    expect(await getGymBranding('gym-d')).toEqual({ name: null, logoUrl: null });
  });
});
