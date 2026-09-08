# GymOS Handbook

Role-by-role operating manual (Super Admin, gym staff, member) plus a guided
walkthrough. Replaces the retired `gymos-walkthrough.vercel.app` page, whose
demo credentials were public and are now deleted.

**Published as a Claude artifact:**
https://claude.ai/code/artifact/ef067b1e-52b6-4889-a5c6-37aaa8690ea6

`index.html` is a single self-contained file — no build step, no dependencies
beyond Google Fonts. To host it anywhere else, deploy this directory as a
static site (on Vercel: "Other" framework preset, no build command, output
directory `docs/handbook`).

## Deliberately contains no credentials

The Super Admin password, the store-review phone number and its fixed OTP are
**not** in this file, and must not be added. The page it replaces published
working credentials to anyone with the link. Reviewers get the test account
through the App Store Connect / Play Console review notes; everyone else asks
the platform owner.

Re-check before every publish:

    grep -nE "GymOS_Password|info@smartsana|699000001|123456" docs/handbook/index.html

## Keeping it accurate

The permission matrix is transcribed from `apps/dashboard/components/shared/Sidebar.tsx`
(`NAV_ITEMS`), and the appointment rules from `supabase/migrations/0061_staff_creation_role_ceiling_enforcement.sql`.
If either changes, update this page to match — it is a manual copy, not generated.
