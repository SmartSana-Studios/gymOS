import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { Brand } from '@/constants/brand';
import { supabase } from '@/lib/supabase';

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// Story 8.3: per constants/brand.ts's existing doc comment, the onboarding
// flow is part of the platform shell and always uses Brand.accent -- never a
// per-gym override. The context default (Brand.accent) is what any consumer
// gets when read outside a Provider, so onboarding screens need no special
// casing: they simply never mount GymAccentColorProvider.
const GymAccentColorContext = createContext<string>(Brand.accent);

// Story 8.3 (Review finding): module-level cache so every independent
// GymAccentColorProvider mount (tabs layout, plan modal) reuses the same
// resolved color instead of each one restarting from Brand.accent and
// re-fetching -- avoids a visible flash back to the default gold plus a
// redundant network round trip every time the plan modal opens.
let cachedAccent: string | null = null;
let inFlightFetch: Promise<string> | null = null;

async function resolveGymAccentColor(): Promise<string> {
  try {
    const { data, error } = await supabase.from('gyms').select('primary_color').maybeSingle();
    const color = data?.primary_color;
    return !error && typeof color === 'string' && HEX_COLOR_RE.test(color) ? color : Brand.accent;
  } catch {
    return Brand.accent;
  }
}

function fetchGymAccentColor(): Promise<string> {
  if (cachedAccent) return Promise.resolve(cachedAccent);
  if (!inFlightFetch) {
    inFlightFetch = resolveGymAccentColor()
      .then((resolved) => {
        cachedAccent = resolved;
        return resolved;
      })
      .finally(() => {
        inFlightFetch = null;
      });
  }
  return inFlightFetch;
}

/** Wrap authenticated, gym-context screens (tabs, plan modal -- wired in
 * Story 8.5) with this Provider. Fetches the caller's own gym's
 * `primary_color` once per app session (cached across mounts) via the
 * existing `read own gym` RLS policy (no explicit gym id needed -- same
 * pattern already used by `(tabs)/index.tsx`'s
 * `supabase.from('gyms').select('name, logo_url')`), hex-validates it, and
 * falls back to `Brand.accent` when unset, malformed, or the fetch fails. */
export function GymAccentColorProvider({ children }: { children: ReactNode }) {
  const [accent, setAccent] = useState<string>(cachedAccent ?? Brand.accent);

  useEffect(() => {
    if (cachedAccent) return;
    let cancelled = false;

    fetchGymAccentColor().then((resolved) => {
      if (!cancelled) setAccent(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return <GymAccentColorContext.Provider value={accent}>{children}</GymAccentColorContext.Provider>;
}

export function useGymAccentColor(): string {
  return useContext(GymAccentColorContext);
}
