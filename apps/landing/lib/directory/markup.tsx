// Story 25.3 (AD-44, AD-48): the directory document as React elements, rendered to a STRING by renderToStaticMarkup (handler.ts). No App Router page
// (those ship Next scripts), no executable script (the one <script> a page may carry is the inert JSON-LD data block that handler.ts splices in after rendering), no style="" attribute (the CSP hashes the one <style> block), no cookie, no third-party request. This
// module is presentational: the handler decides what to show and passes plain data. Hostile gym text is a React text node (escaped), never markup.
import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { DIRECTORY_COPY, GLYPH } from "./copy";

export interface Crumb {
  label: string;
  /** Null for the current page. */
  href: string | null;
}

export interface CardView {
  name: string;
  href: string;
  count: string;
}

export interface RowView {
  name: string;
  /** `https://{page_name}.{rootDomain}/` */
  href: string;
  /** Absolute logo URL under the media origin, or null for the monogram tile. */
  logoSrc: string | null;
  categoryLabel: string | null;
  city: string;
}

export interface PillView {
  label: string;
  href: string;
  current: boolean;
}

export interface PageLinkView {
  n: number;
  href: string;
  current: boolean;
}

export type DirectoryBody =
  | { kind: "top"; cards: CardView[]; lede: string; count: string | null; empty: string | null }
  | { kind: "country"; cards: CardView[]; count: string }
  | {
      kind: "city";
      count: string;
      pills: PillView[];
      rows: RowView[];
      pager: PageLinkView[] | null;
      /** The stale-link text and its "show all" link: a valid category with no gym in the city. */
      stale: { message: string; showAllLabel: string; showAllHref: string } | null;
      empty: string | null;
    };

export interface DirectoryDocument {
  locale: Locale;
  title: string;
  description: string;
  /** The ONE flag: false renders `<meta name="robots" content="noindex">` here and `X-Robots-Tag: noindex` in headers.ts. */
  indexable: boolean;
  canonical: string;
  alternates: { en: string; fr: string; xDefault: string };
  /** The same page in the other language (path and query), relative to the host. */
  languageHref: string;
  homeHref: string;
  gymsHref: string;
  crumbs: Crumb[];
  /** The h1: a lead and the place name as the accent fragment. */
  heading: { lead: string; accent: string };
  body: DirectoryBody;
}

// Look per apps/landing/DESIGN.md and the "Public Directory" section of the UX DESIGN.md: navy hero band, 76 px cards in 1/2/3 columns, 80 px
// rows, 44 px targets, no motion. One <style> block; the quotes below are CSS, not HTML (React does not escape a <style> child).
export const DIRECTORY_CSS = [
  "@font-face{font-family:'Bricolage Grotesque';font-style:normal;font-weight:800;font-display:swap;src:url(/fonts/bricolage-grotesque-800.woff2) format('woff2')}",
  "@font-face{font-family:'Figtree';font-style:normal;font-weight:400 600;font-display:swap;src:url(/fonts/figtree-variable.woff2) format('woff2')}",
  "*,*::before,*::after{box-sizing:border-box}",
  "html{-webkit-text-size-adjust:100%}",
  "body{margin:0;background:#F6F8FB;color:#3A485C;font:400 16px/1.625 Figtree,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;overflow-wrap:anywhere}",
  "h1,h2,p,ul,ol{margin:0}",
  "ul,ol{padding:0;list-style:none}",
  "a{color:inherit}",
  "a:focus-visible{outline:3px solid #0F1B2D;outline-offset:2px;border-radius:4px}",
  ".on-navy a:focus-visible{outline-color:#FFFFFF}",
  ".wrap{max-width:76rem;margin:0 auto;padding:0 20px}",
  ".skip{position:absolute;left:-9999px;top:0;z-index:10;background:#FFFFFF;color:#0F1B2D;padding:12px 16px;font-weight:600}",
  ".skip:focus{left:16px;top:8px}",
  ".top{background:#0F1B2D;color:#FFFFFF}",
  ".bar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:68px}",
  ".brand{display:inline-flex;align-items:center;min-height:44px;font:800 20px/1 'Bricolage Grotesque',system-ui,sans-serif;letter-spacing:-.02em;color:#FFFFFF;text-decoration:none}",
  ".bar-links{display:flex;align-items:center;gap:8px}",
  ".chip{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid rgba(169,183,203,.6);border-radius:12px;color:#FFFFFF;font-size:15px;font-weight:600;line-height:1.4;text-decoration:none}",
  ".chip:hover{border-color:#FFFFFF}",
  ".hero{padding:8px 0 48px}",
  ".crumbs ol{display:flex;flex-wrap:wrap;align-items:center}",
  ".crumbs li{display:inline-flex;align-items:center;font-size:15px;font-weight:600;color:#A9B7CB}",
  ".crumbs li+li::before{content:'\\203A';padding:0 8px;color:#A9B7CB}",
  ".crumbs a{display:inline-flex;align-items:center;min-height:44px;color:#A9B7CB}",
  ".crumbs [aria-current]{color:#FFFFFF}",
  "h1{margin-top:8px;font:800 32px/1.06 'Bricolage Grotesque',system-ui,sans-serif;letter-spacing:-.028em;text-wrap:balance;color:#FFFFFF}",
  ".accent{color:#E0971F}",
  ".lede{margin-top:16px;max-width:34rem;font-size:18px;color:#A9B7CB;text-wrap:pretty}",
  ".count{margin-top:16px;font-size:18px;font-weight:600;color:#FFFFFF}",
  "main{padding:40px 0 80px}",
  ".cards{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}",
  ".card a{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:76px;padding:16px 20px;background:#FFFFFF;border:1px solid #7F8FA6;border-radius:16px;color:#0F1B2D;text-decoration:none}",
  ".card a:hover{border-color:#0F1B2D}",
  ".card h2{font:800 22px/1.2 'Bricolage Grotesque',system-ui,sans-serif;letter-spacing:-.02em}",
  ".card p{font-size:15px;line-height:1.4;color:#59687C}",
  ".arrow{flex:none;font:800 24px/1 'Bricolage Grotesque',system-ui,sans-serif;color:#BA6500}",
  ".pills{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}",
  ".pills a{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 16px;background:#FFFFFF;border:1px solid #7F8FA6;border-radius:999px;color:#0F1B2D;font-size:15px;font-weight:600;line-height:1.4;text-decoration:none}",
  ".pills a:hover{border-color:#0F1B2D}",
  ".pills a[aria-current]{background:#E0971F;border-color:#E0971F}",
  ".rows{display:grid;gap:8px;max-width:52rem}",
  ".row a{display:flex;align-items:center;gap:16px;min-height:80px;padding:16px 20px;background:#FFFFFF;border:1px solid #7F8FA6;border-radius:16px;color:#0F1B2D;text-decoration:none}",
  ".row a:hover{border-color:#0F1B2D}",
  ".logo,.mono{flex:none;width:48px;height:48px;border-radius:9px}",
  ".logo{object-fit:cover;background:#E1E7EF}",
  ".mono{display:flex;align-items:center;justify-content:center;background:#1B2A41;color:#FFFFFF;font:800 22px/1 'Bricolage Grotesque',system-ui,sans-serif}",
  ".row h2{font:800 20px/1.2 'Bricolage Grotesque',system-ui,sans-serif;letter-spacing:-.02em}",
  ".row p{font-size:15px;line-height:1.4;color:#59687C}",
  ".pager{margin-top:32px}",
  ".pager ul{display:flex;flex-wrap:wrap;gap:8px}",
  ".pager a{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0 12px;background:#FFFFFF;border:1px solid #7F8FA6;border-radius:12px;color:#0F1B2D;font-weight:600;text-decoration:none}",
  ".pager a[aria-current]{background:#1B2A41;border-color:#1B2A41;color:#FFFFFF}",
  ".note{max-width:34rem;font-size:18px;color:#0F1B2D}",
  ".note a{display:inline-flex;align-items:center;min-height:44px;margin-top:8px;font-weight:600}",
  ".foot{background:#0F1B2D;color:#A9B7CB;padding:16px 0}",
  ".foot ul{display:flex;flex-wrap:wrap;align-items:center;gap:0 24px}",
  ".foot a{display:inline-flex;align-items:center;min-height:44px;font-size:15px;font-weight:600;color:#A9B7CB}",
  "@media (min-width:641px){.wrap{padding:0 32px}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}h1{font-size:40px}}",
  "@media (min-width:1024px){.cards{grid-template-columns:repeat(3,minmax(0,1fr))}h1{font-size:52px}.hero-top .hero-copy{max-width:50%}}",
].join("\n");

function Cards({ cards }: { cards: CardView[] }): ReactNode {
  return (
    <ul className="cards">
      {cards.map((c) => (
        <li key={c.href} className="card">
          <a href={c.href}>
            <div>
              <h2>{c.name}</h2>
              <p>{c.count}</p>
            </div>
            <span className="arrow" aria-hidden="true">
              {GLYPH.arrow}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Rows({ rows }: { rows: RowView[] }): ReactNode {
  return (
    <ul className="rows">
      {rows.map((r) => (
        <li key={r.href} className="row">
          <a href={r.href}>
            {r.logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- a plain <img> in a script-free document; next/image would ship its client runtime
              <img className="logo" src={r.logoSrc} alt="" width="48" height="48" loading="lazy" decoding="async" />
            ) : (
              <span className="mono" aria-hidden="true">
                {Array.from(r.name.trim())[0]?.toUpperCase() ?? ""}
              </span>
            )}
            <div>
              <h2>{r.name}</h2>
              <p>{[r.categoryLabel, r.city].filter(Boolean).join(" · ")}</p>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function DirectoryPage({ doc }: { doc: DirectoryDocument }): ReactNode {
  const copy = DIRECTORY_COPY[doc.locale];
  const { body } = doc;
  const isTop = body.kind === "top";
  return (
    <html lang={doc.locale}>
      {/* eslint-disable-next-line @next/next/no-head-element -- a whole document rendered to a string, not an App Router layout */}
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{doc.title}</title>
        <meta name="description" content={doc.description} />
        {doc.indexable ? null : <meta name="robots" content="noindex" />}
        <link rel="canonical" href={doc.canonical} />
        <link rel="alternate" hrefLang="en" href={doc.alternates.en} />
        <link rel="alternate" hrefLang="fr" href={doc.alternates.fr} />
        <link rel="alternate" hrefLang="x-default" href={doc.alternates.xDefault} />
        <style>{DIRECTORY_CSS}</style>
      </head>
      <body>
        <a className="skip" href="#content">
          {copy.skip}
        </a>
        <header className="top on-navy">
          <div className="wrap">
            <div className="bar">
              <a className="brand" href={doc.homeHref} aria-label={copy.homeLabel}>
                {copy.siteName}
              </a>
              <div className="bar-links">
                <a className="chip" href={doc.languageHref} lang={doc.locale === "en" ? "fr" : "en"} hrefLang={doc.locale === "en" ? "fr" : "en"}>
                  {copy.otherLanguageName}
                </a>
              </div>
            </div>
            <div className={isTop ? "hero hero-top" : "hero"}>
              <div className="hero-copy">
                <nav className="crumbs" aria-label={copy.breadcrumbLabel}>
                  <ol>
                    {doc.crumbs.map((c, i) => (
                      <li key={i}>{c.href ? <a href={c.href}>{c.label}</a> : <span aria-current="page">{c.label}</span>}</li>
                    ))}
                  </ol>
                </nav>
                <h1>
                  {doc.heading.lead} <span className="accent">{doc.heading.accent}</span>
                </h1>
                {body.kind === "top" ? <p className="lede">{body.lede}</p> : null}
                {body.kind === "top" ? (body.count ? <p className="count">{body.count}</p> : null) : <p className="count">{body.count}</p>}
              </div>
            </div>
          </div>
        </header>
        <main id="content">
          <div className="wrap">
            {body.kind === "top" ? (body.empty ? <p className="note">{body.empty}</p> : <Cards cards={body.cards} />) : null}
            {body.kind === "country" ? <Cards cards={body.cards} /> : null}
            {body.kind === "city" ? (
              <>
                {body.pills.length > 0 ? (
                  <nav aria-label={copy.categoriesLabel}>
                    <ul className="pills">
                      {body.pills.map((p) => (
                        <li key={p.href}>
                          <a href={p.href} aria-current={p.current ? "page" : undefined}>
                            {p.current ? <span aria-hidden="true">{GLYPH.check}</span> : null}
                            {p.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </nav>
                ) : null}
                {body.stale ? (
                  <p className="note">
                    {body.stale.message}
                    <br />
                    <a href={body.stale.showAllHref}>{body.stale.showAllLabel}</a>
                  </p>
                ) : null}
                {body.empty ? <p className="note">{body.empty}</p> : null}
                {body.rows.length > 0 ? <Rows rows={body.rows} /> : null}
                {body.pager ? (
                  <nav className="pager" aria-label={copy.pagesLabel}>
                    <ul>
                      {body.pager.map((p) => (
                        <li key={p.n}>
                          <a href={p.href} aria-label={copy.pageLink(p.n)} aria-current={p.current ? "page" : undefined}>
                            {p.n}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </nav>
                ) : null}
              </>
            ) : null}
          </div>
        </main>
        <footer className="foot">
          <div className="wrap">
            <ul>
              <li>
                <a href={doc.homeHref}>{copy.siteName}</a>
              </li>
              <li>
                <a href={doc.gymsHref}>{copy.gyms}</a>
              </li>
            </ul>
          </div>
        </footer>
      </body>
    </html>
  );
}
