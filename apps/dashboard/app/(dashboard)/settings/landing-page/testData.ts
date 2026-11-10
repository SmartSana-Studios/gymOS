import { gymPageStatusSchema, type GymPageStatus } from "@gymos/types";
import type { LandingPageData } from "@/services/landing-page";

export function makeStatus(over: Record<string, unknown> = {}): GymPageStatus {
  return gymPageStatusSchema.parse({
    state: "in_progress",
    template: null,
    published_at: null,
    unpublished_reasons: [],
    missing: ["no_name", "no_logo", "no_banner", "about_short", "no_city", "no_contact", "no_hours", "no_public_plan"],
    bad_text_fields: [],
    about_min_chars: 100,
    languages: [
      { code: "en", complete: false, characters: 60, needed: 40 },
      { code: "fr", complete: false, characters: 0, needed: 100 },
    ],
    media: [],
    snapshot: { name: "Grace Fit", default_language: "en" },
    taken_down_reason: null,
    appeal: null,
    ...over,
  });
}

export function makeData(over: Omit<Partial<LandingPageData>, "status"> & { status?: Record<string, unknown> } = {}): LandingPageData {
  const { status, ...rest } = over;
  return {
    gymId: "11111111-1111-4111-8111-111111111111",
    role: "owner",
    status: makeStatus(status),
    pageName: { name: null, state: "none", pending_name: null, completed_renames: 0, redirects: [] },
    content: {
      about: { en: "x".repeat(60), fr: "" },
      services: { en: "", fr: "" },
      address: "",
      city: "",
      lat: "",
      lng: "",
      hours: null,
      contactPhone: "",
      contactWhatsapp: "",
      country: "CM",
      category: "pilates_studio",
      defaultLanguage: "en",
    },
    plans: [
      { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", name: "Monthly", planType: "monthly", price: 10000, currency: "XAF", billingInterval: "monthly", durationDays: 30, isPublic: false },
    ],
    ...rest,
  };
}
