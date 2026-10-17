/** Where a denied (admin) request goes. Shared by the (admin) layout and by pages whose data load failed. */
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
