# Version verification, V1.7 Step 1 (AD-33..AD-41), checked 2026-10-15

Method: official Supabase docs via WebFetch/WebSearch. Several reference pages returned 404 or omitted detail; those items are marked unconfirmed rather than assumed.

## Summary
Confirmed 9, contradicted 0, unconfirmed 6 (one of them a materially risky design assumption: item 4b).

## Findings

| # | Claim | AD | Verdict | Source / note |
|---|---|---|---|---|
| 1a | JWT has `aal` claim, aal1/aal2; absent = aal1 | AD-34, 38 | Confirmed | https://supabase.com/docs/guides/auth/auth-mfa |
| 1b | `amr` array of objects with `method` and `timestamp`, most recent first; method `totp` for TOTP, `otp` for phone/email OTP | AD-36, 40 | Confirmed | same page. Timestamp format shown as Unix seconds in the example only. |
| 1c | RLS / functions can read `aal` and `amr` via `auth.jwt()` | AD-34, 36 | Confirmed | same page shows `(select auth.jwt()->>'aal') = 'aal2'` and `jsonb_path_query(auth.jwt(), '$.amr[0]')`. SECURITY DEFINER reading it is standard (auth.jwt() reads the request GUC), but no doc page states it for SECURITY DEFINER explicitly. |
| 1d | AD-36 "amr entry for a one-time-code method within 5 minutes" | AD-36, 40 | Partly confirmed | `totp` method name is documented. Caveat: `amr[0]` is only the most recent entry; refreshing a token may not add a new `totp` entry with a new timestamp, so freshness of the second-factor timestamp must be tested in the spike. Unconfirmed from docs. |
| 2a | Multiple verified TOTP factors per user | AD-38 | Confirmed | https://supabase.com/docs/reference/javascript/auth-mfa-api (docs text: "allow users to enroll more than 1 TOTP factor"); the 2nd factor as recovery is documented advice |
| 2b | Hosted cap of 10 | AD-38, open items | Confirmed for docs text ("upper limit of 10"); not confirmed as the live hosted setting. The spine already lists it as a spike item. Dashboard has a per-user cap setting per a supabase/auth commit. Two factors needed, so low risk. |
| 3 | No native recovery codes for TOTP | AD-38 | Confirmed | https://supabase.com/docs/reference/javascript/auth-mfa-api ("We don't support recovery codes") |
| 4a | `auth.admin.mfa.deleteFactor` signs the user out of all sessions if the factor was verified | AD-38 | Confirmed | https://supabase.com/docs/reference/javascript/auth-admin-mfa-deletefactor (via search result text). Takes `id` and `userId`. |
| 4b | Enrolling a SECOND factor requires aal2 (server-enforced) | AD-38 | **Unconfirmed, likely not enforced by default** | Docs state aal2 only for unenrolling a verified factor (https://supabase.com/docs/reference/javascript/auth-mfa-unenroll). Enroll page states no aal2 requirement. AD-38 says "after the flip ... enrolling or removing a factor needs AAL2": removing is documented; enrolling is not. A holder of a stolen aal1 session could enroll an extra factor. The AD must either enforce it itself (restrictive RLS cannot gate the auth API; needs the MFA verification hook / a before-user-factor hook, or proxy enroll through an edge function that checks `aal`) or drop the claim. Test in the spike. |
| 4c | Verifying a factor logs out other sessions | AD-38 | Informational | enroll reference page says verify promotes the session to aal2 and logs out all other sessions. Design should account for this (e.g. second-device enrollment signs the first device out). Not stated in ADs. |
| 5a | `auth.admin.signOut(jwt, scope)` takes the user's JWT, not a user id; scope global / local / others | AD-34 | Confirmed | https://supabase.com/docs/reference/javascript/auth-admin-signout (jwt and scope params; scope values not listed there, taken from Swift ref and signout guide) |
| 5b | A supported revoke-all-by-user-id API exists | AD-34 | Unconfirmed (none found) | AD-34 deliberately deletes `auth.sessions` rows via service role. Docs (https://supabase.com/docs/guides/auth/sessions) say sign-out itself deletes rows from `auth.sessions` and that `session_id` in the JWT corresponds to the row, so row deletion is the same effect as sign-out. But direct writes to the auth schema are not documented as supported; AD-34/open items already flag it as a spike. Note a documented alternative: the same page recommends checking that the JWT's `session_id` still exists in `auth.sessions` for sensitive actions, which is a stronger live check than the AD's. Suggest AD-34's live check include it. |
| 5c | Revoked session's access token stays valid until expiry | AD-34 | Confirmed | https://supabase.com/docs/guides/auth/sessions (JWT remains cryptographically valid until it expires; default 1 h) |
| 6 | Time-box and inactivity limits are Pro-plan features | AD-40 | Confirmed | https://supabase.com/docs/guides/auth/sessions ("Pro Plans and up"); applied at next refresh, so effective length = limit + JWT expiry |
| 7a | `vault.create_secret(secret, name, description)` and `vault.update_secret(id, ...)` exist | AD-36, 37 | Confirmed | https://supabase.com/docs/guides/database/vault |
| 7b | Delete a secret via SQL | AD-36, 37 | Unconfirmed | Vault page does not document delete; `delete from vault.secrets where id = ...` is the usual route and needs privilege on `vault.secrets`. Verify. |
| 7c | SECURITY DEFINER function owned by non-superuser (e.g. postgres) can call vault functions on hosted | AD-36 | Unconfirmed | Vault page only says to carefully control role access and shows `postgres` granting access. Not documented for definer functions; spike on hosted project. Repo memory also notes service-role/pooler traps. |
| 8 | pgcrypto `hmac()` available on hosted Supabase | AD-39 | Unconfirmed from docs fetched | Extensions page and pgcrypto page fetch returned 404 / no list. pgcrypto is long-standing in Supabase (extensions schema), so the claim is very likely true; call it as `extensions.hmac(...)` or confirm search_path. Verify with `select extensions.hmac('a','b','sha256')` in the spike. |
| 9 | AD-38 "checked 2026-10-15" notes and AD-34 "valid until expires (checked 2026-10-15)" | AD-34, 38 | Consistent with docs found | Date stamps are asserted by the author; this review corroborates the content but cannot corroborate the date. |
| 9b | `[ASSUMPTION]` markers (provider account-holder name, velocity limits) | AD-36, 41 | Not external fact to verify | Left as marked. |
| 9c | AD-40 "provider's rate limits" for wrong TOTP codes | AD-40 | Unconfirmed | Not located in docs fetched (MFA page lists none). Verify limits exist for `mfa.verify`/`challengeAndVerify` or rely solely on the application counter. |
| 9d | Support sign-in "by phone only" with phone OTP being aal1 | AD-38 | Confirmed in principle | phone OTP method listed under aal1 conventional sign-in. Phone provider on hosted project is a project setting, not checked. |

## Items needing action before Step 1 stories
1. AD-38: the "enrolling a factor needs AAL2" rule has no documented server enforcement (item 4b). Add an enforcement mechanism or restate.
2. AD-36/40: verify `amr` timestamp freshness after token refresh (item 1d).
3. Spike list: add vault delete and SECURITY DEFINER vault access (7b, 7c), pgcrypto hmac schema (8), provider TOTP rate limits (9c), and the session_id-in-auth.sessions live check (5b).
