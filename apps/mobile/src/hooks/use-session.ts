import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/** Root-layout auth gate (Story 2.6, Task 4). `isLoading` stays true until
 * the AsyncStorage-persisted session has actually been read once -- gating
 * on that, not just `session === null`, avoids a flash of the onboarding
 * flow for a returning, already-authenticated member before the persisted
 * session has had a chance to load.
 *
 * `isOnboarded` mirrors the same `users.display_name IS NULL` signal
 * `otp.tsx` already checks (Scope Note #2). Gating the root navigator on
 * `session && isOnboarded` rather than raw session presence matters because
 * `verifyOtp()` sets the session (firing `onAuthStateChange`) well before
 * MA-05/MA-06 ever renders -- gating on session alone would let a brand-new
 * member's session flip the root `Stack.Protected` guard to `(tabs)` before
 * they've ever set a name, skipping profile setup entirely (Review finding,
 * 2026-07-17). `isOnboarded` defaults to `false`, so the gate always favors
 * onboarding until a `display_name` is actually confirmed. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function refreshOnboardedState(currentSession: Session | null) {
      if (!currentSession) {
        if (!cancelled) setIsOnboarded(false);
        return;
      }
      const { data } = await supabase
        .from('users')
        .select('display_name')
        .eq('id', currentSession.user.id)
        .single();
      if (!cancelled) setIsOnboarded(!!data?.display_name);
    }

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        await refreshOnboardedState(data.session);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      void refreshOnboardedState(newSession);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { session, isOnboarded, isLoading };
}
