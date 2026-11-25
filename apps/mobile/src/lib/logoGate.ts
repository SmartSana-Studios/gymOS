/** Story 31.3 (FR-231): the gate the share capture waits at for the gym logo. A composition with no logo is ready at once; one with a logo is ready when
 * the logo has loaded or failed (`settle`), or when the wait times out (the image is then made without waiting longer: a logo that never answers is
 * left out). A new logo key re-arms the gate. A timed-out wait removes itself, so nothing waits forever and nothing leaks. Pure: it holds no view. */
export interface LogoGate {
  /** The logo has loaded or failed (or there is none): everything waiting goes on. */
  settle: () => void;
  /** Resolves at once when settled, else when `settle` runs or `timeoutMs` passes. Never rejects. */
  ready: () => Promise<void>;
  /** Called with the composition's logo URL (null for none): a changed key re-arms the gate (no logo: settled); the same key changes nothing. */
  reset: (logoKey: string | null) => void;
  /** How many waits are open (for tests). */
  waiting: () => number;
}

export function createLogoGate(timeoutMs: number): LogoGate {
  let key: string | null | undefined;
  let settled = false;
  let waiters: { resolve: () => void; timer: ReturnType<typeof setTimeout> }[] = [];

  const settle = () => {
    settled = true;
    const open = waiters;
    waiters = [];
    for (const waiter of open) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  };

  const ready = () => {
    if (settled) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          waiters = waiters.filter((w) => w !== waiter);
          resolve();
        }, timeoutMs),
      };
      waiters.push(waiter);
    });
  };

  const reset = (logoKey: string | null) => {
    if (key === logoKey) return;
    key = logoKey;
    if (logoKey === null) settle();
    else settled = false;
  };

  return { settle, ready, reset, waiting: () => waiters.length };
}
