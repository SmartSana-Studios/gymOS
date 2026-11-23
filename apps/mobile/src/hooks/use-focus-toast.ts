import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { consumePendingToast } from '@/lib/pendingToast';

export const TOAST_MS = 3000;

/** Story 30.4: the one-shot message the /goal sheet leaves behind (lib/pendingToast.ts), shown as a toast for three seconds by whichever screen takes
 * focus next. Profile and Home both use it, so a goal saved from either leaves nothing for the other. Returns the message to render, or null. */
export function useFocusToast(): string | null {
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const message = consumePendingToast();
      if (message) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setToast(message);
        timerRef.current = setTimeout(() => setToast(null), TOAST_MS);
      }
    }, []),
  );

  return toast;
}
