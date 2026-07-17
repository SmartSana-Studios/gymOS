import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/** Root-layout auth gate (Story 2.6, Task 4; Story 2.7 Task 7). `isLoading`
 * stays true until the AsyncStorage-persisted session has actually been
 * read once -- gating on that, not just `session === null`, avoids a flash
 * of the onboarding flow for a returning, already-authenticated member
 * before the persisted session has had a chance to load.
 *
 * `isOnboarded` reads the caller's *current* `members` row's
 * `onboarding_completed_at` -- "current" meaning the same
 * most-recently-created, non-deactivated tie-break the JWT claims hook uses
 * (0009_auth_hook_gym_claims.sql), readable via `self_read_own_membership`
 * (0013). This used to key off `users.display_name IS NULL`
 * (Story 2.6), but that signal only ever meant "has a name" -- MA-05
 * (Profile Setup) sets it long before MA-06/07/08 (goal, experience level,
 * plan confirmation) ever run, so a brand-new member was routed straight to
 * `(tabs)` the instant they saved a name, skipping this story's entire
 * screen set (Story 2.7 Scope Note #1). Gating the root navigator on
 * `session && isOnboarded` rather than raw session presence matters because
 * `verifyOtp()` sets the session (firing `onAuthStateChange`) well before
 * onboarding ever finishes rendering -- gating on session alone would flip
 * the root `Stack.Protected` guard to `(tabs)` before onboarding completes
 * (Review finding, 2026-07-17, Story 2.6). `isOnboarded` defaults to
 * `false`, so the gate always favors onboarding until
 * `onboarding_completed_at` is actually set. */
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
        .from('members')
        .select('onboarding_completed_at')
        .eq('user_id', currentSession.user.id)
        .is('deactivated_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setIsOnboarded(!!data?.onboarding_completed_at);
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
