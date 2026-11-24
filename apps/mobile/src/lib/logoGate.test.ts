import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogoGate } from './logoGate';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Resolves true once the promise has settled (after the timers and microtasks the test has run), without awaiting it forever. */
async function settled(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  return done;
}

describe('createLogoGate', () => {
  it('no logo: ready at once, nothing to wait for', async () => {
    const gate = createLogoGate(3000);
    gate.reset(null);
    expect(await settled(gate.ready())).toBe(true);
    expect(gate.waiting()).toBe(0);
  });

  it('a logo: waits until the logo settles (loaded or failed), then everything waiting goes on', async () => {
    const gate = createLogoGate(3000);
    gate.reset('https://cdn.example/a.png');
    const first = gate.ready();
    const second = gate.ready();
    expect(await settled(first)).toBe(false);
    expect(gate.waiting()).toBe(2);
    gate.settle();
    expect(await settled(first)).toBe(true);
    expect(await settled(second)).toBe(true);
    expect(gate.waiting()).toBe(0);
    // Settled stays settled for later waits.
    expect(await settled(gate.ready())).toBe(true);
  });

  it('gives up after the timeout and removes its waiter (a logo that never answers is left out)', async () => {
    const gate = createLogoGate(3000);
    gate.reset('https://cdn.example/a.png');
    const wait = gate.ready();
    await vi.advanceTimersByTimeAsync(2999);
    expect(await settled(wait)).toBe(false);
    expect(gate.waiting()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(wait)).toBe(true);
    expect(gate.waiting()).toBe(0);
    // The gate itself is still not settled: the next wait waits again (and gives up again), it does not leak the timed-out one.
    const again = gate.ready();
    expect(gate.waiting()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await settled(again)).toBe(true);
    expect(gate.waiting()).toBe(0);
  });

  it('a settle cancels the timeout of the waiters it releases (no timer left running)', async () => {
    const gate = createLogoGate(3000);
    gate.reset('https://cdn.example/a.png');
    void gate.ready();
    gate.settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a new logo key re-arms the gate; the same key changes nothing; no logo settles it again', async () => {
    const gate = createLogoGate(3000);
    gate.reset('https://cdn.example/a.png');
    gate.settle();
    expect(await settled(gate.ready())).toBe(true);
    gate.reset('https://cdn.example/a.png');
    expect(await settled(gate.ready())).toBe(true);
    gate.reset('https://cdn.example/b.png');
    const wait = gate.ready();
    expect(await settled(wait)).toBe(false);
    gate.settle();
    expect(await settled(wait)).toBe(true);
    gate.reset(null);
    expect(await settled(gate.ready())).toBe(true);
  });

  it('dropping the logo while someone waits releases them', async () => {
    const gate = createLogoGate(3000);
    gate.reset('https://cdn.example/a.png');
    const wait = gate.ready();
    gate.reset(null);
    expect(await settled(wait)).toBe(true);
    expect(gate.waiting()).toBe(0);
  });
});
