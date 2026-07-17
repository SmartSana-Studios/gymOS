import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY -- copy apps/mobile/.env.example to apps/mobile/.env.local',
  );
}

// AsyncStorage-backed session persistence -- Supabase's official Expo
// quickstart pattern (architecture.md line 108), already installed
// (apps/mobile/package.json). No URL-based session detection: no deep
// link, recovery link, or email link ships in any onboarding flow
// (docs/decisions.md#2026-07-15 "Onboarding/account-recovery channel
// policy") -- there is no URL for a session to ever arrive in.
// No `Database` generic -- matches every other Supabase client in this
// project (apps/dashboard/lib/supabase/*.ts), which are deliberately
// loosely-typed and rely on packages/types' Zod schemas for validation
// instead (see apps/dashboard/services/members.ts's own comment on this).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
