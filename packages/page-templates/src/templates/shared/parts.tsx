// Pieces every template draws the same way: the section marker, the gym's text in one language, the language link or menu, the contact actions.
// A template styles them through its own stylesheet (class names `lang`, `ct`, `tiles`, `tile`, `call`, `nums`); the markup and the contract
// (data-section, data-action, order Call, WhatsApp, Directions) live here once. A pure module like the templates: React, @gymos/types, siblings.
import { PAGE_CONTENT_LANGUAGES, type PageContentLanguage, type PageContentSnapshotV1 } from "@gymos/types";
import type { Chrome, RenderEnv, SectionId } from "../../contract";
import { directionsHref, telHref, whatsappHref } from "../../format";
import { DirectionsIcon, PhoneIcon, WhatsAppIcon } from "./icons";

export const section = (id: SectionId) => ({ "data-section": id });

type TextKey = "about" | "services";

/** The gym's text in one language, or undefined. The key is built from the language so a new language needs no change here. */
export function text(content: PageContentSnapshotV1, key: TextKey, lang: PageContentLanguage): string | undefined {
  const v = (content as Record<string, unknown>)[`${key}_${lang}`];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export function LanguageNav({ env, locale, names, label }: { env: RenderEnv; locale: PageContentLanguage; names: Record<string, string>; label: string }) {
  const codes = PAGE_CONTENT_LANGUAGES.filter((l) => env.languageOrder.includes(l));
  if (codes.length < 2) return null;
  const nameOf = (c: string) => names[c] ?? c;
  if (codes.length === 2) {
    const other = codes.find((c) => c !== locale) ?? codes[0]!;
    return (
      <nav className="lang" aria-label={label}>
        <a href={`/${other}`} hrefLang={other} lang={other}>
          {nameOf(other)}
        </a>
      </nav>
    );
  }
  // More than two complete languages: a native disclosure (no script) listing plain links; the current language is marked, not a link.
  return (
    <nav className="lang" aria-label={label}>
      <details>
        <summary lang={locale}>{nameOf(locale)}</summary>
        <ul>
          {codes.map((c) => (
            <li key={c}>
              {c === locale ? (
                <span aria-current="true" lang={c}>
                  {nameOf(c)}
                </span>
              ) : (
                <a href={`/${c}`} hrefLang={c} lang={c}>
                  {nameOf(c)}
                </a>
              )}
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}

export function ContactActions({ content, chrome }: { content: PageContentSnapshotV1; chrome: Chrome }) {
  const phone = content.contact?.phone;
  const whatsapp = content.contact?.whatsapp;
  const map = content.map;
  if (!phone && !whatsapp && !map) return null;
  return (
    <section className="ct w" {...section("contact")}>
      <div className="tiles">
        {phone ? (
          <a className="tile call" href={telHref(phone)} data-action="call">
            <PhoneIcon />
            <span>{chrome.call}</span>
          </a>
        ) : null}
        {whatsapp ? (
          <a className="tile" href={whatsappHref(whatsapp)} data-action="whatsapp" rel="noopener noreferrer">
            <WhatsAppIcon />
            <span>{chrome.whatsapp}</span>
          </a>
        ) : null}
        {map ? (
          <a className="tile" href={directionsHref(map.lat, map.lng)} data-action="directions" rel="noopener noreferrer">
            <DirectionsIcon />
            <span>{chrome.directions}</span>
          </a>
        ) : null}
      </div>
      {phone || whatsapp ? (
        <div className="nums">
          {phone ? (
            <p>
              <span>{chrome.phone}</span>
              {phone}
            </p>
          ) : null}
          {whatsapp && whatsapp !== phone ? (
            <p>
              <span>{chrome.whatsapp}</span>
              {whatsapp}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
