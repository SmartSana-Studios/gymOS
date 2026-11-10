// Classic: the first real template (DESIGN.md "Classic template"). Story 24.13 redesign: bold hero, light bands, dark visit band. A pure module: it exports `render` and
// nothing else, imports nothing but React, @gymos/types and its own siblings, and renders every string from the gym as a React text node.
import type { ReactNode } from "react";
import { PAGE_CONTENT_LANGUAGES, PAGE_HOURS_DAYS, type PageContentLanguage, type PageContentSnapshotV1, type PageContentV1 } from "@gymos/types";
import { CHROME } from "../../chrome";
import type { Chrome, RenderEnv, SectionId } from "../../contract";
import { countryName, directionsHref, excerpt, formatPrice, lines, mapHref, paragraphs, telHref, whatsappHref } from "../../format";
import { DirectionsIcon, MapTile, PhoneIcon, WhatsAppIcon } from "./icons";
import { classicCss } from "./styles";

const section = (id: SectionId) => ({ "data-section": id });

type TextKey = "about" | "services";

/** The gym's text in one language, or undefined. The key is built from the language so a new language needs no change here. */
function text(content: PageContentSnapshotV1, key: TextKey, lang: PageContentLanguage): string | undefined {
  const v = (content as Record<string, unknown>)[`${key}_${lang}`];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function LanguageNav({ env, locale, names, label }: { env: RenderEnv; locale: PageContentLanguage; names: Record<string, string>; label: string }) {
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

function ContactActions({ content, chrome }: { content: PageContentSnapshotV1; chrome: Chrome }) {
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

function render(page: PageContentV1, locale: PageContentLanguage, env: RenderEnv): ReactNode {
  const c = page.content;
  const chrome = CHROME[locale];
  const media = (key: string) => `${env.mediaBase}/${key}`;
  const about = text(c, "about", locale);
  const aboutParagraphs = about ? paragraphs(about) : [];

  // Block fallback: only Services can be empty in a complete language; it shows the next language that has it, with that block's own lang.
  const servicesLang = env.languageOrder.find((l) => text(c, "services", l) !== undefined);
  const servicesText = servicesLang ? text(c, "services", servicesLang) : undefined;
  const serviceItems = servicesText ? lines(servicesText) : [];

  const plans = c.plans ?? [];
  const gallery = c.gallery ?? [];
  const hours = c.hours;
  const hasHours = hours !== undefined;
  const location = [c.address, c.city, c.country ? countryName(c.country, locale) : undefined].filter((v): v is string => Boolean(v)).join(", ");
  const category = c.category ? chrome.categories[c.category] : undefined;
  const subtitleLocation = [c.city, c.country ? countryName(c.country, locale) : undefined].filter((v): v is string => Boolean(v)).join(", ");
  const primaryAction = c.contact?.phone
    ? { href: telHref(c.contact.phone), label: chrome.call, external: false }
    : c.contact?.whatsapp
      ? { href: whatsappHref(c.contact.whatsapp), label: chrome.whatsapp, external: true }
      : undefined;
  const description = about ? excerpt(about) : undefined;
  const titleParts = [c.name, [category, c.city].filter(Boolean).join(", ")].filter(Boolean);
  const names = Object.fromEntries(env.languageOrder.map((l) => [l, CHROME[l].languageName]));

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{titleParts.join(" - ")}</title>
        {description ? <meta name="description" content={description} /> : null}
        {env.alternates
          ? [
              ...PAGE_CONTENT_LANGUAGES.filter((l) => env.languageOrder.includes(l)).map((l) => <link key={l} rel="alternate" hrefLang={l} href={`${env.origin}/${l}`} />),
              <link key="x-default" rel="alternate" hrefLang="x-default" href={`${env.origin}/`} />,
            ]
          : null}
        <style>{classicCss(env.colors)}</style>
      </head>
      <body>
        <div className="page">
          <div className={c.banner ? "hero" : "hero nb"}>
            <header className="hd w" {...section("header")}>
              <div className="top">
                {c.logo ? (
                  <div className="logo">
                    <img src={media(c.logo)} alt={c.name} width="96" height="96" decoding="async" />
                  </div>
                ) : (
                  <span />
                )}
                {env.languageLinks ? <LanguageNav env={env} locale={locale} names={names} label={chrome.languageLabel} /> : null}
              </div>
              <div className="id">
                {category || subtitleLocation ? <p className="eyebrow">{[category, subtitleLocation].filter(Boolean).join(" \u00B7 ")}</p> : null}
                <h1>{c.name}</h1>
              </div>
            </header>
            {c.banner ? (
              <div className="bn" {...section("banner")}>
                <img src={media(c.banner)} alt="" width="1600" height="900" fetchPriority="high" decoding="async" />
              </div>
            ) : null}
            <ContactActions content={c} chrome={chrome} />
          </div>
          <main>
            {aboutParagraphs.length > 0 ? (
              <div className="w duo">
                <section className={serviceItems.length > 0 ? "sec ab" : "sec ab wide"} {...section("about")} aria-labelledby="h-about">
                  <h2 id="h-about">{chrome.about}</h2>
                  {aboutParagraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </section>
                {serviceItems.length > 0 ? (
                  <section className="sec sv" {...section("services")} aria-labelledby="h-services">
                    <h2 id="h-services">{chrome.services}</h2>
                    <ul className="checks" lang={servicesLang !== locale ? servicesLang : undefined}>
                      {serviceItems.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            ) : null}
            {plans.length > 0 ? (
              <div className="plans-s">
                <section className="sec w" {...section("plans")} aria-labelledby="h-plans">
                  <h2 id="h-plans">{chrome.plans}</h2>
                  <ul>
                    {plans.map((p, i) => (
                      <li key={i} className="plan">
                        <h3>{p.name}</h3>
                        <p className="price">{formatPrice(p.price, p.currency, locale)}</p>
                        <ul className="checks">
                          <li>{chrome.planType[p.type]}</li>
                          {p.type !== "pay_per_session" ? <li>{chrome.planInterval[p.interval]}</li> : null}
                          {p.duration_days ? <li>{chrome.duration(p.duration_days)}</li> : null}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            ) : null}
            {hasHours || location ? (
              <div className="visit">
                <div className={hasHours && location ? "w grid" : "w grid one"}>
                  {hasHours ? (
                    <section className="sec hr" {...section("hours")} aria-labelledby="h-hours">
                      <h2 id="h-hours">{chrome.hours}</h2>
                      <ul className="rows">
                        {PAGE_HOURS_DAYS.map((d) => {
                          const day = hours[d];
                          return (
                            <li key={d}>
                              <span>{chrome.days[d]}</span>
                              <span>{day ? `${day.open} \u2013 ${day.close}` : chrome.closed}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ) : null}
                  {location ? (
                    <section className="sec lc" {...section("location")} aria-labelledby="h-location">
                      <h2 id="h-location">{chrome.location}</h2>
                      {c.map ? <MapTile /> : null}
                      <address>{location}</address>
                      {c.map ? (
                        <a className="pill" href={mapHref(c.map.lat, c.map.lng)} rel="noopener noreferrer">
                          {chrome.openMap}
                        </a>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              </div>
            ) : null}
            {gallery.length > 0 ? (
              <section className="sec gl" {...section("gallery")} aria-labelledby="h-gallery">
                <div className="w">
                  <h2 id="h-gallery">{chrome.gallery}</h2>
                  <ul>
                    {gallery.map((key, i) => (
                      <li key={key + i}>
                        <img src={media(key)} alt={chrome.photo(i + 1, gallery.length)} width="1600" height="1200" loading="lazy" decoding="async" />
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : null}
            {primaryAction ? (
              <div className="rp" data-role="repeat-action">
                <p>{c.name}</p>
                <a href={primaryAction.href} {...(primaryAction.external ? { rel: "noopener noreferrer" } : {})}>
                  {primaryAction.label}
                </a>
              </div>
            ) : null}
          </main>
          <footer className="ft" {...section("footer")}>
            <div className="w">
              <a href="/report">{chrome.reportPage}</a>
              <p>
                {chrome.madeWith}{" "}
                <a href={`${env.wwwOrigin}/${locale}`} rel="noopener noreferrer">
                  GymOS
                </a>
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

export { render };
