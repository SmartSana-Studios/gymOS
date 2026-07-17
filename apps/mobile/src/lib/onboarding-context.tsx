import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { MobileLocale } from '@/lib/i18n';

/** Local-only onboarding progress (Story 2.6, Task 4/UX-DR6). Nothing here
 * is persisted -- `language` is provisional until Story 2.7's MA-08
 * finalizes it into `users.preferred_language`; `phone`/`otpVerified` exist
 * only to let `onboarding/_layout.tsx`'s sequencing guard block direct
 * out-of-order navigation and to let MA-04's "Try again" pre-fill MA-02
 * with the phone the member already typed this session. Resets naturally
 * whenever the provider unmounts (e.g. the member leaves onboarding). */
interface OnboardingProgressValue {
  language: MobileLocale | null;
  phone: string | null;
  otpVerified: boolean;
  setLanguage: (language: MobileLocale) => void;
  setPhone: (phone: string) => void;
  setOtpVerified: (verified: boolean) => void;
}

const OnboardingProgressContext = createContext<OnboardingProgressValue | null>(null);

export function OnboardingProgressProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<MobileLocale | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [otpVerified, setOtpVerified] = useState(false);

  const value = useMemo(
    () => ({ language, phone, otpVerified, setLanguage, setPhone, setOtpVerified }),
    [language, phone, otpVerified],
  );

  return <OnboardingProgressContext.Provider value={value}>{children}</OnboardingProgressContext.Provider>;
}

export function useOnboardingProgress(): OnboardingProgressValue {
  const ctx = useContext(OnboardingProgressContext);
  if (!ctx) {
    throw new Error('useOnboardingProgress must be used within OnboardingProgressProvider');
  }
  return ctx;
}
