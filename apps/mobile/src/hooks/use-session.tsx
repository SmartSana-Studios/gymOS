import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

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
 * `onboarding_completed_at` is actually set.
 *
 * Story 15.x (Review finding): wrapped in a Context (`SessionProvider`,
 * below) rather than left as a plain hook -- `onboarding/body-profile.tsx`'s
 * `goHome()` needs to wait for *this exact* `isOnboarded` state (the one
 * driving the root `Stack.Protected` guard in `_layout.tsx`) to flip before
 * it's safe to consider the member routed to `(tabs)`. A second,
 * independent `useSession()` call would fetch its own separate copy on its
 * own timeline -- reading the same Context instance instead is what makes
 * that wait meaningful. */
function useSessionState() {
  const [session, setSession] = useState<Session | null>(null);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [gymId, setGymId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Story 11.4 (AC #1, #3): true once this member's gym is
  // suspended/deactivated. `_layout.tsx`'s root guard routes here instead
  // of `(tabs)`/`onboarding` -- a member's own `members` row is denied by
  // the new tenant_active_gate RESTRICTIVE policy (0073) in that state, so
  // this must be resolved from the JWT `gym_id` claim (below), not from the
  // now-gated `members` query this hook already runs.
  const [isSuspended, setIsSuspended] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refreshOnboardedState(currentSession: Session | null) {
      if (!currentSession) {
        if (!cancelled) {
          setIsOnboarded(false);
          setGymId(null);
          setIsSuspended(false);
        }
        return;
      }

      // Story 11.4: gym_id/app_role are minted into every authenticated
      // session's JWT claims regardless of gym status
      // (0009_auth_hook_gym_claims.sql's custom_access_token_hook --
      // suspension enforcement is deliberately invisible at the claims-
      // minting layer, same as the dashboard's session.ts). Reading gym_id
      // from claims here, before the members query below, is what lets a
      // suspended gym's member be routed to the neutral block screen
      // instead of that now-gated query silently returning empty and
      // falling through to onboarding (isOnboarded defaults to false).
      const { data: claimsData } = await supabase.auth.getClaims();
      const claimGymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id ?? null;

      if (claimGymId) {
        // `gyms` itself stays unrestricted regardless of status (the
        // dashboard's own "read own gym" policy, 0009) -- this read always
        // succeeds even for a suspended/deactivated gym.
        const { data: gymRow, error: gymStatusError } = await supabase
          .from('gyms')
          .select('status')
          .eq('id', claimGymId)
          .maybeSingle();
        if (gymStatusError) {
          // Review finding: a transient failure here (not "gym not found")
          // must not fall through to the members query below -- for a
          // suspended member that query is now RLS-denied and returns
          // empty, which would be misread as "not onboarded" and misroute
          // to the onboarding flow instead of the suspended screen. Bail
          // out and let the next auth-state-change retry instead of
          // committing to a guess.
          console.error('[useSession] gym status lookup failed', gymStatusError);
          return;
        }
        if (gymRow && gymRow.status !== 'active') {
          if (!cancelled) {
            setIsSuspended(true);
            setIsOnboarded(false);
            setGymId(claimGymId);
          }
          return;
        }
      }

      const { data } = await supabase
        .from('members')
        .select('onboarding_completed_at, gym_id')
        .eq('user_id', currentSession.user.id)
        .is('deactivated_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setIsSuspended(false);
        setIsOnboarded(!!data?.onboarding_completed_at);
        // Story 9.5: sourced for app_opened's analytics payload -- same
        // current-membership row/tie-break isOnboarded already reads.
        setGymId(data?.gym_id ?? null);
      }
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

  return { session, isOnboarded, gymId, isLoading, isSuspended };
}

type SessionValue = ReturnType<typeof useSessionState>;

const SessionContext = createContext<SessionValue | null>(null);

/** Mounted once in `_layout.tsx`, above `RootNavigator` -- every `useSession()`
 * call below reads this single instance's state. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const value = useSessionState();
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return value;
}
