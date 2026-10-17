/** Where a denied (admin) request goes. Shared by the (admin) layout, the Server Action gate and pages whose data load failed. */

/** Denials that mean "this session cannot be used here": the user must be sent to login or the code prompt. A
 * denial for any other reason (for example `authorization_unavailable`, a transient backend failure) is NOT one:
 * the session may still be good, so callers show an error instead of bouncing the user. */
export function endsSession(reason: string): boolean {
  return (
    reason === "aal2_required" ||
    reason === "session_expired" ||
    reason === "account_locked" ||
    reason === "no_session" ||
    reason === "not_super_admin"
  );
}

export function loginRedirectFor(reason: string): string {
  // Story 22.6: a valid password session below aal2 while the flag is on goes to the second-factor prompt,
  // never into a login loop. Every other denial stays on login.
  if (reason === "aal2_required") return "/auth/mfa";
  if (
    reason === "session_expired" ||
    reason === "account_locked" ||
    // A still-signed token whose session the provider no longer knows: the session ended.
    reason === "no_session"
  ) {
    return "/auth/login?expired=1";
  }
  // A signed-in account that is not a Super Admin: say so instead of reloading the form silently.
  if (reason === "not_super_admin") return "/auth/login?denied=1";
  return "/auth/login";
}
