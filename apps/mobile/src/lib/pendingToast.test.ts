import { describe, expect, it } from 'vitest';

import { consumePendingToast, setPendingToast } from './pendingToast';

describe('pendingToast', () => {
  it('hands a message over once', () => {
    expect(consumePendingToast()).toBeNull();
    setPendingToast('Goal saved. Starts Mon 23 Nov.');
    expect(consumePendingToast()).toBe('Goal saved. Starts Mon 23 Nov.');
    expect(consumePendingToast()).toBeNull();
  });

  it('keeps only the latest message', () => {
    setPendingToast('first');
    setPendingToast('second');
    expect(consumePendingToast()).toBe('second');
  });
});
