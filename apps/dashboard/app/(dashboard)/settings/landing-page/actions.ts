"use server";

import {
  claimLandingPageName,
  getLandingPageData,
  publishLandingPage,
  saveLandingPageContent,
  unpublishLandingPage,
} from "@/services/landing-page";

// Story 24.9. Thin Server Action wrappers: the service validates every input again, and the database admits the caller.
// These actions take no gym id (the service reads the session's gym). The image actions in ../page-media-actions.ts do pass one;
// the database checks it against the caller. Free text is cleaned (CRLF to LF) in the service, not only in the form.

export async function loadLandingPageAction() {
  return getLandingPageData();
}

export async function saveLandingPageAction(input: unknown) {
  return saveLandingPageContent(input);
}

export async function claimPageNameAction(name: string) {
  return claimLandingPageName(name);
}

export async function publishPageAction(template: string | null) {
  return publishLandingPage(template);
}

export async function unpublishPageAction() {
  return unpublishLandingPage();
}
