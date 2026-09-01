import { randomUUID } from "node:crypto";

import { test, expect } from "@playwright/test";

import { loadFixtures } from "./helpers/fixtures";
import { loginViaUi, signInForApi, callRpc } from "./helpers/auth";
import { supabaseAnonKey, supabaseUrl } from "./helpers/env";

// Story 13.5 Task 6 -- Flow 3: progress-data access boundaries (NFR-016).
// Hybrid per the story's own design: seed via APIRequestContext (the real
// member-app write path -- progress_entries then progress_photos, RLS-gated
// table inserts, not hand-crafted rows bypassing RLS), verify via the
// dashboard's real Coach Portal UI.

test.describe("Flow 3: progress-data access boundaries", () => {
  // This spec mutates shared global fixtures non-idempotently (logs new
  // progress entries/photos, reassigns the member's coach) -- a CI retry
  // after a transient failure would re-run these mutations against
  // already-mutated state (e.g. a second shared photo breaking the
  // toHaveCount(1) assertion below), producing a new, misleading
  // deterministic failure that masks the original transient one.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.retry > 0, "non-idempotent against shared global fixtures -- see file header");
  });

  test("re-verified on every request: coach loses access the instant reassignment happens", async ({ page, request }) => {
    const fixtures = loadFixtures();

    // Subtask 6.1: log two progress entries as the seeded Member, one
    // shared photo, one not -- via the real REST insert path
    // (progress_entries then progress_photos), matching
    // apps/mobile/src/services/progress.ts's own logProgressEntry()
    // sequencing.
    const memberSession = await signInForApi(request, { phone: fixtures.member.phone });
    const restHeaders = {
      apikey: supabaseAnonKey(),
      Authorization: `Bearer ${memberSession.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };

    // A real (if trivial) JPEG, not an empty buffer -- the bucket's
    // `allowed_mime_types` is content-type-gated at upload time
    // (0066_body_profile_progress_entry_logging.sql), and the Coach
    // Portal's own createSignedUrls() call needs a real object to sign
    // against for the shared-photo assertion below to mean anything.
    const ONE_PX_JPEG = Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64",
    );

    async function logEntryWithPhoto(sharedWithCoach: boolean, suffix: string) {
      const clientEntryId = randomUUID();
      const entryResponse = await request.post(`${supabaseUrl()}/rest/v1/progress_entries`, {
        headers: restHeaders,
        data: {
          member_id: fixtures.member.memberId,
          gym_id: fixtures.gymId,
          weight_kg: 80,
          client_entry_id: clientEntryId,
        },
      });
      expect(entryResponse.ok()).toBe(true);
      const [entryRow] = (await entryResponse.json()) as { id: string }[];

      // Real Storage upload via the same {auth.uid()}/{client_entry_id}.{ext}
      // path convention photo-upload.ts's own uploadProgressPhoto() uses --
      // reuses the same clientEntryId the progress_entries row above was
      // just created with, not a second, unrelated id. `-${suffix}` is a
      // test-only disambiguator (this test logs two entries in the same
      // run) appended after the real id, before the extension.
      // member_insert_own_progress_photo's RLS policy requires the path's
      // first folder segment to equal the caller's own auth.uid().
      const photoPath = `${fixtures.member.userId}/${clientEntryId}-${suffix}.jpg`;
      const uploadResponse = await request.post(`${supabaseUrl()}/storage/v1/object/progress-photos/${photoPath}`, {
        headers: {
          apikey: supabaseAnonKey(),
          Authorization: `Bearer ${memberSession.accessToken}`,
          "Content-Type": "image/jpeg",
        },
        data: ONE_PX_JPEG,
      });
      expect(uploadResponse.ok()).toBe(true);

      const photoResponse = await request.post(`${supabaseUrl()}/rest/v1/progress_photos`, {
        headers: restHeaders,
        data: {
          member_id: fixtures.member.memberId,
          gym_id: fixtures.gymId,
          progress_entry_id: entryRow.id,
          photo_path: photoPath,
          shared_with_coach: sharedWithCoach,
        },
      });
      expect(photoResponse.ok()).toBe(true);
    }

    await logEntryWithPhoto(true, "shared");
    await logEntryWithPhoto(false, "unshared");

    // Subtask 6.2: as the currently-assigned Coach, the Progress tab shows
    // exactly the one shared photo -- inspecting the actual rendered DOM
    // (a Server Component render; the unshared photo's data never reaches
    // the client at all under RLS, not merely CSS-hidden).
    await loginViaUi(page, fixtures.coach.email);
    await page.goto(`/coach/${fixtures.member.memberId}`);
    await page.getByRole("tab", { name: "Progress" }).click();

    // Scoped to PhotoGallery's own thumbnail grid (grid-cols-3/sm:grid-cols-4
    // wrapper), not a bare page-wide alt-text match -- avoids matching any
    // other current or future image whose alt text happens to contain
    // "progress"/"photo" (e.g. the lightbox's own <img>, which shares the
    // same alt text but only renders after a thumbnail is clicked).
    await expect(page.locator(".grid img[alt*=\"progress\" i], .grid img[alt*=\"photo\" i]")).toHaveCount(1);

    // Subtask 6.3: reassign the member to a different coach mid-session,
    // then re-request the same Progress tab data from the *same
    // already-authenticated* original-coach browser session -- proving
    // NFR-016's "re-verified on every request, no caching window."
    const ownerSession = await signInForApi(request, { email: fixtures.owner.email });
    const reassignResponse = await callRpc(request, ownerSession, "assign_coach", {
      p_member_id: fixtures.member.memberId,
      p_coach_id: fixtures.secondCoach.memberId,
    });
    expect(reassignResponse.ok()).toBe(true);

    await page.reload();
    await expect(page.getByText("This member could not be found.")).toBeVisible();
  });
});
