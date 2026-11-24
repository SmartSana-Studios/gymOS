import { useSyncExternalStore } from 'react';

import { readEngagementCache, type CachedEngagement } from '@/lib/weeklyRing';

/** Story 31.4: the one answer to "is the engagement area on for this member", read by exactly two places: the Home streak line and the Streak screen.
 * The tab bar does not read it (five tabs in every state, Streak never hidden, no Progress tab), and neither does Profile's Progress row (always shown).
 * The gate starts from the device copy of the last good row (`readEngagementCache`, never a second cache) so a cold start does not wait for the network, and
 * the server's answer corrects it: an engagement `row` outcome sets it to `on`, a `dark` outcome to `off`, and a failed or offline read changes nothing. It is
 * `unknown` until the device copy or a read answers, and `unknown` behaves as `off` (the Streak screen's one calm line, no Home line). Reset on sign-out and on a member change.
 * No other screen may read the engagement flag any other way (engagementGate.test.ts scans for it). */
export type EngagementGate = 'on' | 'off' | 'unknown';

export interface GateState {
  /** `${userId}.${gymId}` the gate answers for, or null when nobody is signed in. */
  key: string | null;
  gate: EngagementGate;
}

export type GateEvent =
  /** A member is signed in (or the member or gym changed): the same member keeps the gate, another starts from `unknown`. */
  | { type: 'bind'; key: string }
  /** The device copy of the last good row answered: `enabled` is the copy's flag, null when there is no copy. Never overrides a live answer. */
  | { type: 'cache'; key: string; enabled: boolean | null }
  /** A live engagement read answered for this member. */
  | { type: 'outcome'; key: string; outcome: 'row' | 'dark' | 'failed' }
  /** Sign-out, or the tabs unmounted. */
  | { type: 'reset' };

export const INITIAL_GATE: GateState = { key: null, gate: 'unknown' };

export function gateKey(userId: string, gymId: string): string {
  return `${userId}.${gymId}`;
}

/** The pure transition table of the I/O matrix (the gate reducer). */
export function reduceGate(state: GateState, event: GateEvent): GateState {
  switch (event.type) {
    case 'reset':
      return INITIAL_GATE;
    case 'bind':
      return state.key === event.key ? state : { key: event.key, gate: 'unknown' };
    case 'cache': {
      // Another member's copy, or a copy that arrives after a live answer, never moves the gate.
      if (state.key !== event.key || state.gate !== 'unknown' || event.enabled === null) return state;
      return { key: state.key, gate: event.enabled ? 'on' : 'off' };
    }
    case 'outcome': {
      if (event.outcome === 'failed') return state;
      // A live answer is adopted when the gate is not bound yet (Home can answer before the tab layout's effect has run) or is bound to the same member.
      // An answer for another member (a stale read finishing after a member change) must not replace the new member's gate or drop their cache seed.
      if (state.key !== null && state.key !== event.key) return state;
      return { key: event.key, gate: event.outcome === 'row' ? 'on' : 'off' };
    }
  }
}

let state: GateState = INITIAL_GATE;
const listeners = new Set<() => void>();

function dispatch(event: GateEvent): void {
  const next = reduceGate(state, event);
  if (next === state || (next.key === state.key && next.gate === state.gate)) return;
  state = next;
  listeners.forEach((listener) => listener());
}

export function getEngagementGate(): EngagementGate {
  return state.gate;
}

export function subscribeEngagementGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sign-out (and the tabs unmounting): back to `unknown`. */
export function resetEngagementGate(): void {
  dispatch({ type: 'reset' });
}

/** A live engagement read answered for this member: `row` turns the gate on, `dark` turns it off, `failed` changes nothing. */
export function setEngagementGateFromOutcome(userId: string, gymId: string, outcome: 'row' | 'dark' | 'failed'): void {
  dispatch({ type: 'outcome', key: gateKey(userId, gymId), outcome });
}

/** Binds the gate to the signed-in member and seeds it from the device copy of the last good row. A member change resets it to `unknown` first. */
export async function bindEngagementGate(userId: string, gymId: string, readCache: (userId: string, gymId: string) => Promise<CachedEngagement | null> = readEngagementCache): Promise<void> {
  const key = gateKey(userId, gymId);
  dispatch({ type: 'bind', key });
  let copy: CachedEngagement | null = null;
  try {
    copy = await readCache(userId, gymId);
  } catch {
    copy = null;
  }
  dispatch({ type: 'cache', key, enabled: copy ? copy.engagement.enabled : null });
}

/** The gate, re-rendering the caller when it changes. */
export function useEngagementGate(): EngagementGate {
  return useSyncExternalStore(subscribeEngagementGate, getEngagementGate, getEngagementGate);
}
