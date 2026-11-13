// Story 25.3: every word of the directory pages, in both languages, in ONE dictionary (the same rule as lib/copy.ts: no sentence is typed into
// markup). Category labels are NOT here: they come from the page-templates chrome (`CHROME.categories`). City and gym names are shown as entered.
// Draft copy that EXPERIENCE.md PS-04 to PS-06 flags [ASSUMPTION] is marked below.
import type { Locale } from "@/lib/i18n";

export interface DirectoryCopy {
  siteName: string;
  skip: string;
  homeLabel: string;
  breadcrumbLabel: string;
  categoriesLabel: string;
  pagesLabel: string;
  /** The breadcrumb root and the header link: "Gyms". */
  gyms: string;
  /** The language link's text: the OTHER language's own name. */
  otherLanguageName: string;
  all: string;
  /** Accessible name of a numbered page link. */
  pageLink(n: number): string;
  top: { titleLead: string; titleAccent: string; lede: string; metaDescription: string; empty: string; countSentence(gyms: number, countries: number): string; mapCaption: string };
  country: { titleLead: string; metaDescription(country: string): string; countSentence(gyms: number, cities: number): string };
  city: {
    titleLead: string;
    metaDescription(city: string, country: string): string;
    countSentence(gyms: number, city: string): string;
    /** The PS-06 stale-link text: a valid category with no gym in the city. */
    noneInCategory(category: string, city: string): string;
    showAll(city: string): string;
    /** A city whose view row exists but whose gym rows do not (the views disagree for an instant). */
    empty: string;
  };
  /** "3 gyms" on a country or city card. */
  gymCount(n: number): string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
// French writes 0 and 1 in the singular
const frPlural = (n: number, one: string, many: string): string => (n < 2 ? one : many);

const en: DirectoryCopy = {
  siteName: "GymOS",
  skip: "Skip to content",
  homeLabel: "GymOS home",
  breadcrumbLabel: "Breadcrumb",
  categoriesLabel: "Categories",
  pagesLabel: "Pages",
  gyms: "Gyms",
  otherLanguageName: "Français",
  all: "All",
  pageLink: (n) => `Page ${n}`,
  top: {
    titleLead: "Find a gym",
    titleAccent: "near you",
    lede: "Every gym listed here runs its own page. Pick a country, then a city.", // [ASSUMPTION - copy to confirm]
    metaDescription: "Browse gyms, studios and fitness centers on GymOS by country and city.",
    empty: "No gyms are listed yet.",
    countSentence: (g, c) => `${g} ${plural(g, "gym", "gyms")} in ${c} ${plural(c, "country", "countries")}`,
    mapCaption: "Each dot is a city with gyms. Larger means more gyms.", // [ASSUMPTION - copy to confirm]
  },
  country: {
    titleLead: "Gyms in",
    metaDescription: (country) => `Gyms, studios and fitness centers in ${country}, by city, on GymOS.`,
    countSentence: (g, c) => `${g} ${plural(g, "gym", "gyms")} in ${c} ${plural(c, "city", "cities")}`,
  },
  city: {
    titleLead: "Gyms in",
    metaDescription: (city, country) => `Gyms, studios and fitness centers in ${city}, ${country}, on GymOS.`,
    countSentence: (g, city) => `${g} ${plural(g, "gym", "gyms")} in ${city}`,
    noneInCategory: (category, city) => `No gyms listed under ${category} in ${city} yet.`,
    showAll: (city) => `Show all gyms in ${city}`,
    empty: "No gyms are listed yet.",
  },
  gymCount: (n) => `${n} ${plural(n, "gym", "gyms")}`,
};

const fr: DirectoryCopy = {
  siteName: "GymOS",
  skip: "Aller au contenu",
  homeLabel: "Accueil GymOS",
  breadcrumbLabel: "Fil d'Ariane",
  categoriesLabel: "Catégories",
  pagesLabel: "Pages",
  gyms: "Salles",
  otherLanguageName: "English",
  all: "Toutes",
  pageLink: (n) => `Page ${n}`,
  top: {
    titleLead: "Trouvez une salle",
    titleAccent: "près de chez vous",
    lede: "Chaque salle répertoriée a sa propre page. Choisissez un pays, puis une ville.", // [ASSUMPTION - copy to confirm]
    metaDescription: "Parcourez les salles de sport, studios et centres de fitness sur GymOS, par pays et par ville.",
    empty: "Aucune salle n'est encore répertoriée.",
    countSentence: (g, c) => `${g} ${frPlural(g, "salle", "salles")} dans ${c} pays`,
    mapCaption: "Chaque point est une ville qui compte des salles. Plus grand, plus de salles.", // [ASSUMPTION - copy to confirm]
  },
  country: {
    // « Salles en [pays] » (the draft) is wrong for « au Cameroun » or « aux Comores »: a colon takes any name as entered
    titleLead: "Salles :",
    metaDescription: (country) => `Salles de sport, studios et centres de fitness : ${country}, par ville, sur GymOS.`,
    countSentence: (g, c) => `${g} ${frPlural(g, "salle", "salles")} dans ${c} ${frPlural(c, "ville", "villes")}`,
  },
  city: {
    titleLead: "Salles à",
    metaDescription: (city, country) => `Salles de sport, studios et centres de fitness à ${city} (${country}) sur GymOS.`,
    countSentence: (g, city) => `${g} ${frPlural(g, "salle", "salles")} à ${city}`,
    noneInCategory: (category, city) => `Aucune salle répertoriée dans la catégorie ${category} à ${city} pour l'instant.`,
    showAll: (city) => `Voir toutes les salles à ${city}`,
    empty: "Aucune salle n'est encore répertoriée.",
  },
  gymCount: (n) => `${n} ${frPlural(n, "salle", "salles")}`,
};

export const DIRECTORY_COPY: Record<Locale, DirectoryCopy> = { en, fr };

/** Glyphs, kept out of the markup for the same reason as the words. */
export const GLYPH = { check: "✓" } as const;
