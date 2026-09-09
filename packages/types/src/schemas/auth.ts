import { z } from "zod";

// AD-01 login form. Client-side submit-time feedback only (UX-DR11: validate
// on submit only) -- the actual credential check is Supabase Auth's
// signInWithPassword, which is the true source of truth for "invalid
// credentials"; this schema only catches empty/malformed input before that
// call fires.
//
// WHY THIS ACCEPTS A PHONE NUMBER, NOT JUST AN EMAIL.
// AD-01's mockup specifies "Email address *" as the sole identifier, and that
// held while gym Owners were the only dashboard users: `createGym()`
// (apps/super-admin/app/(admin)/gyms/actions.ts) provisions an Owner with BOTH
// `email` and `phone`. Story 9.1's staff provisioning does not --
// `createStaffMember()` (apps/dashboard/services/staff.ts) calls
// `createUser({ phone, password, phone_confirm: true })` with no email at all,
// so every Supervisor / Manager / Receptionist / Coach account lands with
// `email = ''` and had nothing it could type into an email-only form.
//
// Confirmed empirically against this project's local Supabase before changing
// anything: an account created exactly the way `createStaffMember()` creates
// one rejects `signInWithPassword({ email: "", password })` with
// `400 validation_failed / missing email or phone`, but authenticates fine via
// `signInWithPassword({ phone, password })` -- with OR without the leading "+",
// since GoTrue normalizes on the way in. The accounts were never broken; the
// form simply had no way to address them. Hence a front-end identifier change
// rather than an email backfill or a change to how staff accounts are made.
const E164_LOOSE = /^\+?[1-9]\d{7,14}$/;

// Users type phone numbers with spaces, dashes and parentheses. Strip the
// formatting (never the digits or the leading "+") before deciding whether an
// identifier is a phone, so "+237 699 000 777" is recognised as one.
function stripPhoneFormatting(identifier: string): string {
  return identifier.replace(/[\s().-]/g, "");
}

/** True when the identifier should be sent to GoTrue as a phone rather than an
 * email. Deliberately checked BEFORE the email branch: an email can never match
 * E164_LOOSE (it contains "@" and starts with a letter), so the two are
 * mutually exclusive and the order only documents intent. */
export function isPhoneIdentifier(identifier: string): boolean {
  return E164_LOOSE.test(stripPhoneFormatting(identifier.trim()));
}

/** Canonical E.164 (always "+"-prefixed) for an identifier already known to be
 * a phone. `members.phone` is written by the Zod `e164Phone` schemas, which
 * mandate the "+", so this is the form to compare against that column and the
 * form to hand to `signInWithOtp` -- distinct from
 * `toPasswordCredentials`, which passes through whatever the user typed
 * because GoTrue's own sign-in normalizes either way. */
export function toE164Phone(identifier: string): string {
  const stripped = stripPhoneFormatting(identifier.trim());
  return stripped.startsWith("+") ? stripped : `+${stripped}`;
}

export const loginSchema = z
  .object({
    identifier: z.string().trim().min(1, "Enter your email address or phone number"),
    password: z.string().min(1, "Enter your password"),
  })
  .refine(
    (value) =>
      isPhoneIdentifier(value.identifier) ||
      z.email().safeParse(value.identifier.trim()).success,
    {
      message: "Enter a valid email address or phone number",
      path: ["identifier"],
    },
  );

export type LoginInput = z.infer<typeof loginSchema>;

/** Maps a validated login input onto the credential shape GoTrue expects.
 * Kept here rather than in the form so the email/phone discrimination is
 * unit-testable and cannot drift from `loginSchema`'s own refinement. */
export function toPasswordCredentials(
  input: LoginInput,
):
  | { email: string; password: string }
  | { phone: string; password: string } {
  const identifier = input.identifier.trim();
  return isPhoneIdentifier(identifier)
    ? { phone: stripPhoneFormatting(identifier), password: input.password }
    : { email: identifier, password: input.password };
}
