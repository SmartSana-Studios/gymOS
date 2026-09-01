// Shared shape for the fixture data fixtures/seed.ts writes to
// `e2e/.fixtures.json` (globalSetup output) and every spec file reads back
// (globalSetup runs in a separate process from the test workers, so a JSON
// file -- not an in-memory module -- is how the two communicate; Playwright
// has no built-in globalSetup->test data channel).

// Intentionally a static literal, not a generated/env-supplied secret --
// this only ever authenticates throwaway fixture accounts (globalSetup
// creates them, globalTeardown deletes them) in ephemeral local/CI Supabase
// instances, never a real credential.
export const FIXTURE_PASSWORD = "E2eFixture!2026";

export interface RoleFixture {
  memberId: string;
  userId: string;
  email: string;
  phone: string;
  name: string;
}

export interface MemberFixture {
  memberId: string;
  userId: string;
  phone: string;
  name: string;
}

export interface FixtureData {
  gymId: string;
  planId: string;
  owner: RoleFixture;
  supervisor: RoleFixture;
  manager: RoleFixture;
  coach: RoleFixture;
  /** A second Coach, used solely by Flow 3's mid-session reassignment
   * (Subtask 6.3) -- assign_coach()'s own target-role check requires a real
   * role='coach' member, not any staff role. */
  secondCoach: RoleFixture;
  /** Story 3.3/6.1/7.1's primary Member -- test_otp phone 237670000001. */
  member: MemberFixture;
  /** Class capacity fixtures (Task 7): 2 pre-booked to leave exactly one
   * open slot for the spec's own Subtask 7.1 booking, 2 more left unbooked
   * for Subtask 7.2's concurrent race against the then-full session. */
  classFillerMembers: MemberFixture[];
  classId: string;
  classSessionId: string;
  classCapacity: number;
  /** Optional real, gym-connectable TaraMoney sandbox credentials for Flow
   * 2 (Task 5) -- see docs/decisions.md's Story 13.5 entry. Never committed;
   * absent by default (including in CI), in which case the payment-cutover
   * spec skips itself with an explicit reason. */
  taraMoneyGymCredentialsConnected: boolean;
}

// Playwright transpiles config/globalSetup/spec files as CommonJS
// regardless of tsconfig's module setting, where import.meta is a syntax
// error -- a CWD-relative path instead (globalSetup/globalTeardown/specs
// all run from apps/dashboard, this app's own working directory).
export const FIXTURES_FILE_PATH = "./e2e/.fixtures.json";
