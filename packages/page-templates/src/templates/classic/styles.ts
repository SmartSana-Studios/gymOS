// The Classic template's ONE inline style block (hashed in the CSP). Mobile first, three CSS-only layouts (under 641, 641 to 1023, 1024 and
// up), identical DOM at every width. No external stylesheet, no style attribute, no @import, no url() to another origin. The gym colour is
// reached only through the four custom properties of :root; nothing else from the gym ever enters CSS.
//
// Story 24.13 redesign: a full-bleed hero (the banner under a dark gradient, or a plain dark field with no banner) carrying the name and the
// contact actions, light content bands with an accent bar over every heading, a dark "visit" band for hours and location, sharp 6 px corners.
// The gym colour paints the accent bars, the Call fill, the check marks, the map pin and the focus ring, never a text colour on its own.
import type { GymColors } from "../../contract";
import { FONT_ALLOWLIST } from "../../contract";

export const CLASSIC_FONTS = ["barlow-700", "barlow-800"] as const;

export function classicCss(colors: GymColors): string {
  const faces = CLASSIC_FONTS.map((id) => {
    const f = FONT_ALLOWLIST[id];
    return `@font-face{font-family:${f.family};font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${f.path}) format("woff2")}`;
  }).join("");
  return [
    `:root{--gym:${colors.gym};--ui:${colors.ui};--fill:${colors.fill};--on-gym:${colors.on};--ink:#121B2B;--ink2:#1B2A41;--muted:#4B5563;--bg:#F5F5F1;--card:#FFFFFF;--line:#E3E1DA;--r:6px;--head:Barlow,"Helvetica Neue",Arial,system-ui,sans-serif;--body:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}`,
    faces,
    `*,*::before,*::after{box-sizing:border-box}`,
    `html{-webkit-text-size-adjust:100%;text-size-adjust:100%}`,
    `body{margin:0;background:var(--bg);color:var(--ink2);font:16px/1.6 var(--body);overflow-wrap:anywhere}`,
    `h1,h2,h3,p,ul,address{margin:0}ul{padding:0;list-style:none}address{font-style:normal}`,
    `img{display:block;max-width:100%}a{color:inherit}`,
    `a:focus-visible,summary:focus-visible{outline:3px solid var(--fill);outline-offset:3px;box-shadow:0 0 0 6px #FFFFFF}`,
    `.w{width:100%;max-width:1120px;margin-inline:auto;padding-inline:20px}`,
    // hero: header, banner (behind) and the contact actions share one dark field
    `.hero{position:relative;isolation:isolate;display:flex;flex-direction:column;min-height:min(560px,calc(100svh - 24px));background:var(--ink) linear-gradient(135deg,var(--ink2),var(--ink));color:#FFFFFF}`,
    `.bn{position:absolute;inset:0;z-index:-2;overflow:hidden;background:var(--ink)}`,
    `.bn img{width:100%;height:100%;object-fit:cover}`,
    `.hero::before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(10,15,24,.72) 0,rgba(10,15,24,.62) 35%,rgba(10,15,24,.93) 100%)}`,
    `.hero.nb::after{content:"";position:absolute;right:0;bottom:0;z-index:-1;width:38%;height:8px;background:var(--fill)}`,
    `.hd{flex:1;display:flex;flex-direction:column;justify-content:space-between;gap:28px;padding-block:16px 8px}`,
    `.top{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px}`,
    `.logo{flex:none;width:56px;height:56px;border-radius:50%;border:3px solid var(--fill);background:#FFFFFF;overflow:hidden}`,
    `.logo img{width:100%;height:100%;object-fit:cover}`,
    `.id{padding-top:8px}`,
    `.eyebrow{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;font:700 14px/20px var(--head);letter-spacing:.12em;text-transform:uppercase;color:#FFFFFF}`,
    `.eyebrow::before{content:"";flex:none;width:36px;height:4px;background:var(--fill)}`,
    `.id h1{font:800 clamp(36px,11vw,76px)/.98 var(--head);text-transform:uppercase;letter-spacing:.01em;margin-top:14px;max-width:16ch}`,
    `.lang{margin-left:auto}`,
    `.lang a,.lang summary{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 14px;border:2px solid rgba(255,255,255,.85);border-radius:var(--r);font:700 14px/1 var(--head);letter-spacing:.08em;text-transform:uppercase;text-decoration:none;color:#FFFFFF;cursor:pointer;list-style:none}`,
    `.lang details{position:relative}.lang summary::-webkit-details-marker{display:none}`,
    `.lang ul{position:absolute;right:0;z-index:5;min-width:160px;background:#FFFFFF;color:var(--ink2);border-radius:var(--r);box-shadow:0 12px 32px rgba(0,0,0,.35);padding:4px 14px;margin-top:6px}`,
    `.lang li{display:flex;align-items:center;min-height:44px}.lang [aria-current]{font-weight:800}.lang ul a{color:var(--ink2);border:0;padding:0;min-height:44px;justify-content:flex-start;text-transform:none;letter-spacing:0;font:600 16px/1 var(--body);text-decoration:underline}`,
    // contact actions, inside the hero
    `.ct{padding-block:8px 24px}`,
    `.tiles{display:flex;flex-wrap:wrap;gap:10px}`,
    `.tile{flex:1 1 140px;min-width:0;min-height:52px;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:0 18px;border-radius:var(--r);border:2px solid rgba(255,255,255,.9);background:rgba(10,15,24,.25);color:#FFFFFF;font:700 16px/1 var(--head);letter-spacing:.08em;text-transform:uppercase;text-decoration:none}`,
    `.tile svg{flex:none;width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}`,
    `.tile.call{background:var(--fill);color:var(--on-gym)}`,
    `.nums{display:flex;flex-wrap:wrap;gap:2px 20px;margin-top:14px;font-weight:600;color:#FFFFFF}.nums span{margin-inline-end:6px;font-weight:500;color:#E5E7EB}`,
    // content bands
    `.sec{padding-block:48px}`,
    `.sec h2{font:800 clamp(28px,6vw,40px)/1.05 var(--head);text-transform:uppercase;letter-spacing:.01em;margin-bottom:22px}`,
    `.sec h2::before{content:"";display:block;width:48px;height:4px;background:var(--fill);margin-bottom:14px}`,
    `.duo{display:grid;gap:0;grid-template-columns:minmax(0,1fr)}`,
    `.ab p{max-width:62ch;font-size:17px}.ab p+p{margin-top:14px}`,
    `.sv{background:var(--ink2);color:#FFFFFF;padding:40px 24px;margin-bottom:48px}`,
    `.checks li{position:relative;padding:6px 0 6px 34px}`,
    `.checks li::before{content:"";position:absolute;left:0;top:.55em;width:20px;height:20px;border-radius:50%;background:var(--fill)}`,
    `.checks li::after{content:"";position:absolute;left:7px;top:calc(.55em + 4px);width:7px;height:4px;border:solid var(--on-gym);border-width:0 0 2px 2px;transform:rotate(-45deg)}`,
    `.plans-s{background:#FFFFFF;border-block:1px solid var(--line)}`,
    `.plans-s>.sec>ul{display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}`,
    `.plan{background:var(--bg);border:1px solid var(--line);border-top:5px solid var(--fill);border-radius:var(--r);padding:22px 22px 18px}`,
    `.plan h3{font:700 18px/24px var(--head);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}`,
    `.price{font:800 clamp(34px,8vw,44px)/1.05 var(--head);font-variant-numeric:tabular-nums;margin-top:10px;color:var(--ink)}`,
    `.plan .checks{margin-top:14px;border-top:1px solid var(--line);padding-top:10px}.plan .checks li{font-weight:500}`,
    `.visit{background:var(--ink);color:#FFFFFF}`,
    `.visit .sec{padding-block:48px}.visit .grid{display:grid;gap:8px;grid-template-columns:minmax(0,1fr)}`,
    `.rows li{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-top:1px solid rgba(255,255,255,.2)}.rows li:first-child{border-top:0}`,
    `.rows li span:first-child{font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:14px;color:#E5E7EB}`,
    `.rows li span:last-child{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}`,
    `.map{display:block;width:100%;height:auto;max-height:200px;border-radius:var(--r);margin-bottom:16px}`,
    `.map .pin{fill:var(--fill)}`,
    `.lc address{font-size:18px;font-weight:600}`,
    `.pill{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;margin-top:16px;border-radius:var(--r);border:2px solid #FFFFFF;color:#FFFFFF;text-decoration:none;font:700 15px/1 var(--head);letter-spacing:.08em;text-transform:uppercase}`,
    `.gl ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.gl li:first-child{grid-column:1/-1}`,
    `.gl img{width:100%;height:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r);background:#D9DBD3}`,
    `.rp{background:var(--fill);padding:40px 20px;text-align:center}`,
    `.rp p{font:800 clamp(24px,6vw,34px)/1.05 var(--head);text-transform:uppercase;color:var(--on-gym);margin-bottom:18px}`,
    `.rp a{display:inline-flex;align-items:center;justify-content:center;min-height:56px;min-width:min(100%,280px);padding:0 28px;border-radius:var(--r);background:var(--ink);color:#FFFFFF;border:2px solid var(--ink);text-decoration:none;font:800 18px/1 var(--head);letter-spacing:.1em;text-transform:uppercase}`,
    `.ft{background:var(--ink);color:#D1D5DB;font-size:14px}`,
    `.ft .w{display:flex;flex-wrap:wrap;gap:0 24px;justify-content:space-between;align-items:center;padding-block:10px}`,
    `.ft a{display:inline-flex;align-items:center;min-height:44px;text-decoration:underline;color:#FFFFFF}`,
    // tablet
    `@media (min-width:641px){`,
    `.w{padding-inline:32px}`,
    `.hero{min-height:560px}`,
    `.hd{padding-block:24px 12px}`,
    `.tile{flex:0 1 auto;min-width:176px}`,
    `.plans-s>.sec>ul{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}`,
    `.gl ul{grid-template-columns:repeat(3,minmax(0,1fr))}.gl li:first-child{grid-column:auto}`,
    `.visit .grid{gap:40px;grid-template-columns:repeat(2,minmax(0,1fr))}.visit .grid.one{grid-template-columns:minmax(0,560px)}`,
    `}`,
    // desktop
    `@media (min-width:1024px){`,
    `.hero{min-height:640px}`,
    `.duo{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)}`,
    `.ab.wide{grid-column:1/-1}`,
    `.sv{padding:72px 40px;margin-bottom:0}`,
    `.sec{padding-block:72px}.visit .sec{padding-block:72px}`,
    `.plans-s>.sec>ul{grid-template-columns:repeat(3,minmax(0,1fr))}`,
    `.gl ul{grid-template-columns:repeat(4,minmax(0,1fr))}`,
    `.gl li:first-child:nth-last-child(n+3){grid-column:span 2;grid-row:span 2}`,
    `.gl li:first-child:nth-last-child(n+3) img{aspect-ratio:auto}`,
    `}`,
    // motion: none needed; respect the preference for any future transition
    `@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`,
  ].join("\n");
}
