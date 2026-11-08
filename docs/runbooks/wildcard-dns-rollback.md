# Wildcard DNS (`*.gymosapps.com`) rollback

Story 24.2 (AD-43). Gym landing pages live at `{name}.gymosapps.com`. The wildcard is two things at A2 Hosting, where the nameservers stay (`ns1`-`ns4.a2hosting.com`):

- `NS _acme-challenge` delegated to Vercel (`ns1.vercel-dns.com.`, `ns2.vercel-dns.com.`), so Vercel can issue the wildcard certificate.
- `CNAME *` pointing at the `apps/landing` Vercel project.

Explicit records (apex, `www`, `owner`, `portal`, `mail`, the cPanel names; full list in `docs/dns/gymosapps.com.zone`) win over the wildcard and are never touched by this runbook. Production has real gyms on `owner.` and `portal.`; none of the steps below touches them.

## Records to remove, and who removes them

| Record | Added by | Removed by | How |
|---|---|---|---|
| `CNAME *` -> the `apps/landing` target | product owner, cPanel Zone Editor | product owner | cPanel Zone Editor, delete the `*` row. Effect within the TTL (14400 s = 4 h; lower it to 300 s before the cutover if a fast rollback matters). |
| `NS _acme-challenge` (two records, `ns1`/`ns2.vercel-dns.com.`) | **A2 support**, by ticket | **A2 support**, by ticket (1-2 days) | cPanel on this plan cannot create or delete `NS` records. Open the ticket first, name the exact host `_acme-challenge.gymosapps.com`. |
| Wildcard domain `*.gymosapps.com` on the `apps/landing` Vercel project | product owner | product owner | Vercel project, Settings, Domains, remove. |

Nothing else is added by 24.2, so nothing else is removed.

## Order

1. Remove `CNAME *` first (this stops traffic reaching the landing app; takes effect in the TTL).
2. Open the A2 ticket to remove the `_acme-challenge` `NS` records. This is the slow step; if AutoSSL is failing, do it first.
3. Remove the wildcard domain from Vercel once the records are gone.
4. Verify against the authoritative server, not a public resolver: `dig +short NS _acme-challenge.gymosapps.com @ns1.a2hosting.com` (empty) and `dig +short x.gymosapps.com @ns1.a2hosting.com` (no answer). Public resolvers keep the old answer, and may cache the negative one, for up to the TTL (4 h unless lowered), so `dig` without `@` can lag. Then `dig` each name in `docs/dns/gymosapps.com.zone` against the export.
5. Check `owner.` and `portal.` are unaffected, before the rollback and again after: `curl -sI https://owner.gymosapps.com` and `curl -sI https://portal.gymosapps.com` must still return their usual redirects (307 to `/auth/login...`). Any other answer during a rollback is an incident: stop and look at the explicit `CNAME` records first.

## If the wildcard certificate stalls

Seen once in the 24.1 spike: the wildcard sat in "Generating SSL Certificate" for about four days with no challenge record published. Removing the wildcard domain in the Vercel project and adding it again produced the certificate within minutes, with the A2 records untouched. Do that first, before touching DNS. Check that Vercel DNS is enabled for the zone (Vercel answers authoritatively for `_acme-challenge`).

## AutoSSL straight after delegation

Delegating `_acme-challenge` could in principle block A2's own certificate issuance. The spike delegated `_acme-challenge.test` only and saw no conflict, so this is accepted conditionally.

1. Immediately after A2 adds the real `NS` records: cPanel, SSL/TLS Status, Run AutoSSL. Every domain must show AutoSSL valid with no error.
2. If AutoSSL fails on any domain, remove the delegation at once (the A2 ticket above) and stop; the mail and cPanel certificate matters more than the wildcard.

## Dated checks

| Date | Check |
|---|---|
| from about **2026-12-01** | The A2 certificate (Let's Encrypt, CN `webmail.gymosapps.com`, covering `mail.`, `webmail.`, `cpanel.`) expires **2026-12-31**. AutoSSL should renew it from about 2026-12-01. Confirm in cPanel SSL/TLS Status that it renewed with the delegation in place. |
| issuance date + about **60 days** | First renewal of the wildcard certificate through the delegation. Not yet verified (the spike certificate was removed with its domain). Record the issuance date in the 24.2 completion notes and put the check date in the sprint status. |

Also, when the real wildcard is added, read and record the text of Vercel's "DNS Change Recommended" advisory (the spike did not capture it) in `docs/decisions.md`.

## Rehearsal

The rollback is rehearsed once, after the real delegation exists: add the records, issue, remove them, confirm `dig` matches the export. **The rehearsal is recorded when A2 confirms the 24.1 cleanup** (removal of the two throwaway `_acme-challenge.test` `NS` records), because that confirmation proves the ticket-based removal path end to end. Until then this runbook is unrehearsed.

## Related

- `docs/decisions.md`, 2026-11-08 entry (24.1 spike results).
- `docs/dns/gymosapps.com.zone`, `packages/types/src/constants/reservedLabels.json`, `scripts/check-reserved-labels.mjs`.
