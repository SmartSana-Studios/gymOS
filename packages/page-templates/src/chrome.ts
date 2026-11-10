import type { Chrome, ReportChrome } from "./contract";
import { GYM_CATEGORY_LABELS, type PageContentLanguage } from "@gymos/types";

// Story 24.10: chrome dictionaries, one per content language. EN plan terms and "monthly"/"annual" are the product owner's; every FR
// string, the "billed" phrasing and the duration form are drafted (EXPERIENCE.md "Plan dictionary" marks them [ASSUMPTION]).
// `Record<PageContentLanguage, Chrome>` makes a missing language a compile error; the registry also checks it at load.

const en: Chrome = {
  languageName: "English",
  languageLabel: "Language",
  call: "Call",
  whatsapp: "WhatsApp",
  directions: "Directions",
  openMap: "Open the map",
  about: "About",
  services: "Services and activities",
  plans: "Plans",
  hours: "Opening hours",
  location: "Location",
  gallery: "Gallery",
  closed: "Closed",
  phone: "Phone",
  reportPage: "Report this page",
  madeWith: "Page made with",
  days: { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" },
  categories: Object.fromEntries(Object.entries(GYM_CATEGORY_LABELS).map(([k, v]) => [k, v.en])) as Chrome["categories"],
  planType: { pay_per_session: "per session", monthly: "monthly", coach_inclusive: "coach included", class_only: "classes only" },
  planInterval: { monthly: "billed monthly", annual: "billed annually" },
  duration: (d) => (d === 1 ? "1 day" : `${d} days`),
  photo: (n, total) => `Photo ${n} of ${total}`,
};

const fr: Chrome = {
  languageName: "Français",
  languageLabel: "Langue",
  call: "Appeler",
  whatsapp: "WhatsApp",
  directions: "Itinéraire",
  openMap: "Ouvrir la carte",
  about: "À propos",
  services: "Services et activités",
  plans: "Abonnements",
  hours: "Horaires d'ouverture",
  location: "Où nous trouver",
  gallery: "Galerie",
  closed: "Fermé",
  phone: "Téléphone",
  reportPage: "Signaler cette page",
  madeWith: "Page créée avec",
  days: { mon: "Lundi", tue: "Mardi", wed: "Mercredi", thu: "Jeudi", fri: "Vendredi", sat: "Samedi", sun: "Dimanche" },
  categories: Object.fromEntries(Object.entries(GYM_CATEGORY_LABELS).map(([k, v]) => [k, v.fr])) as Chrome["categories"],
  planType: { pay_per_session: "par séance", monthly: "mensuel", coach_inclusive: "coach inclus", class_only: "cours uniquement" },
  planInterval: { monthly: "facturé mensuellement", annual: "facturé annuellement" },
  duration: (d) => (d === 1 ? "1 jour" : `${d} jours`),
  photo: (n, total) => `Photo ${n} sur ${total}`,
};

export const CHROME: Record<PageContentLanguage, Chrome> = { en, fr };

// Story 24.11 (PS-03): the public report form. EN and FR copy is the product owner's (EXPERIENCE.md PS-03) except the hint, the failure line and
// the anonymity note, which are drafted. The rate-limit line deliberately does not name the page.
const reportEn: ReportChrome = {
  title: "Report this page",
  reasonLegend: "Why are you reporting it?",
  detailsLabel: "Tell us more",
  detailsHint: "Up to 1,000 characters.",
  anonymousNote: "We don't ask for your name or contact details.",
  submit: "Send report",
  errorSummary: "Please fix the following:",
  chooseReason: "Choose a reason.",
  tellUsMore: "Tell us a little more.",
  detailsTooLong: "Use 1,000 characters or fewer.",
  failed: "We couldn't send your report. Try again in a moment.",
  rateLimited: "Too many reports from this connection. Try again later.",
  thanks: "Thank you. We'll review this page.",
  backToPage: "Back to the page",
  honeypotLabel: "Leave this field empty",
};

const reportFr: ReportChrome = {
  title: "Signaler cette page",
  reasonLegend: "Pourquoi la signalez-vous ?",
  detailsLabel: "Dites-nous-en plus",
  detailsHint: "1 000 caractères au maximum.",
  anonymousNote: "Nous ne demandons ni votre nom ni vos coordonnées.",
  submit: "Envoyer le signalement",
  errorSummary: "Veuillez corriger les points suivants :",
  chooseReason: "Choisissez un motif.",
  tellUsMore: "Dites-nous-en un peu plus.",
  detailsTooLong: "Utilisez 1 000 caractères ou moins.",
  failed: "Nous n'avons pas pu envoyer votre signalement. Réessayez dans un instant.",
  rateLimited: "Trop de signalements depuis cette connexion. Réessayez plus tard.",
  thanks: "Merci. Nous allons examiner cette page.",
  backToPage: "Retour à la page",
  honeypotLabel: "Laissez ce champ vide",
};

export const REPORT_CHROME: Record<PageContentLanguage, ReportChrome> = { en: reportEn, fr: reportFr };
