// The Volt template's ONE inline style block (hashed in the CSP). A dark, hard-edged design: near-black page, one accent, bordered cells, no rounding.
// Same rules as Classic: mobile first, three CSS-only layouts (under 641, 641 to 1023, 1024 and up), identical DOM at every width, no external
// stylesheet, no style attribute, no @import, no url() but the two same-origin fonts. The gym colour reaches CSS only through the five custom
// properties of :root. `--fill` paints the strip and the main action (text on it is `--on-gym`); `--acc` (the server's `accent`, checked on the
// lightest dark surface) paints marks and the few accent texts, so a dark or pale gym colour can never vanish into the page.
import type { GymColors } from "../../contract";
import { FONT_ALLOWLIST } from "../../contract";

export const VOLT_FONTS = ["barlow-700", "barlow-800"] as const;

export function voltCss(colors: GymColors): string {
  const faces = VOLT_FONTS.map((id) => {
    const f = FONT_ALLOWLIST[id];
    return `@font-face{font-family:${f.family};font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${f.path}) format("woff2")}`;
  }).join("");
  return [
    `:root{--gym:${colors.gym};--ui:${colors.ui};--fill:${colors.fill};--on-gym:${colors.on};--acc:${colors.accent};--bg:#07080D;--panel:#10131B;--line:rgba(255,255,255,.2);--mute:#C3C8D4;--head:Barlow,"Helvetica Neue",Arial,system-ui,sans-serif;--body:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}`,
    faces,
    `*,*::before,*::after{box-sizing:border-box}`,
    `html{-webkit-text-size-adjust:100%;text-size-adjust:100%;background:var(--bg)}`,
    `body{margin:0;background:var(--bg);color:#FFFFFF;font:16px/1.6 var(--body);overflow-wrap:anywhere}`,
    `h1,h2,h3,p,ul,address{margin:0}ul{padding:0;list-style:none}address{font-style:normal}`,
    `img{display:block;max-width:100%}a{color:inherit}`,
    `a:focus-visible,summary:focus-visible{outline:3px solid var(--acc);outline-offset:3px}`,
    `.w{width:100%;max-width:1120px;margin-inline:auto;padding-inline:20px}`,
    // hero: the strip, the name and the contact actions over the banner
    `.hero{position:relative;isolation:isolate;display:flex;flex-direction:column;min-height:min(620px,calc(100svh - 24px));background:var(--bg)}`,
    `.bn{position:absolute;inset:0;z-index:-2;overflow:hidden;background:var(--bg)}`,
    `.bn img{width:100%;height:100%;object-fit:cover}`,
    `.hero::before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(7,8,13,.82) 0,rgba(7,8,13,.7) 40%,rgba(7,8,13,.97) 100%)}`,
    `.hero.nb::after{content:"";position:absolute;right:0;top:0;bottom:0;z-index:-1;width:42%;background:var(--acc);opacity:.1;clip-path:polygon(38% 0,100% 0,100% 100%,0 100%)}`,
    `.strip{background:var(--fill);color:var(--on-gym)}`,
    `.strip-in{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px}`,
    `.eyebrow{font:700 13px/18px var(--head);letter-spacing:.14em;text-transform:uppercase;color:var(--on-gym)}`,
    `.lang{margin-left:auto}`,
    `.lang a,.lang summary{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 6px;font:700 14px/1 var(--head);letter-spacing:.1em;text-transform:uppercase;text-decoration:underline;text-underline-offset:4px;color:var(--on-gym);cursor:pointer;list-style:none}`,
    `.lang details{position:relative}.lang summary::-webkit-details-marker{display:none}`,
    `.lang ul{position:absolute;right:0;z-index:5;min-width:170px;background:#FFFFFF;color:#121B2B;box-shadow:0 12px 32px rgba(0,0,0,.45);padding:4px 14px;margin-top:2px}`,
    `.lang li{display:flex;align-items:center;min-height:44px}.lang [aria-current]{font-weight:800}.lang ul a{color:#121B2B;min-height:44px;justify-content:flex-start;text-transform:none;letter-spacing:0;font:600 16px/1 var(--body)}`,
    `.hd{flex:1;display:flex;flex-direction:column}`,
    `.copy{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-start;gap:18px;padding-block:56px 22px}`,
    `.logo{flex:none;width:72px;height:72px;border:2px solid var(--acc);background:var(--panel);overflow:hidden}`,
    `.logo img{width:100%;height:100%;object-fit:cover}`,
    `.copy h1{font:800 clamp(38px,9.5vw,76px)/1.02 var(--head);letter-spacing:-.01em;max-width:15ch}`,
    // contact actions, inside the hero
    `.ct{padding-block:6px 36px}`,
    `.tiles{display:flex;flex-wrap:wrap;gap:10px}`,
    `.tile{flex:1 1 140px;min-width:0;min-height:52px;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:0 20px;border:2px solid rgba(255,255,255,.92);background:transparent;color:#FFFFFF;font:700 16px/1 var(--head);letter-spacing:.03em;text-decoration:none}`,
    `.tile svg{flex:none;width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}`,
    `.tile.call{background:var(--fill);color:var(--on-gym)}`,
    `.nums{display:flex;flex-wrap:wrap;gap:2px 22px;margin-top:16px;font-weight:600;color:#FFFFFF}.nums span{margin-inline-end:6px;font-weight:500;color:var(--mute)}`,
    // bands
    `.sec{padding-block:56px}`,
    `.sec h2{font:800 clamp(30px,6vw,44px)/1.05 var(--head);margin-bottom:26px;padding-left:16px;border-left:5px solid var(--acc)}`,
    `.duo{display:grid;gap:0;grid-template-columns:minmax(0,1fr)}`,
    `.ab p{max-width:62ch;font-size:17px;color:var(--mute)}.ab p+p{margin-top:14px}`,
    `.tiles-s{counter-reset:n;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}`,
    `.tiles-s li{counter-increment:n;background:var(--panel);border:1px solid var(--line);padding:20px 18px}`,
    `.tiles-s li::before{content:counter(n,decimal-leading-zero);content:counter(n,decimal-leading-zero) / "";display:block;font:800 28px/1 var(--head);color:var(--acc);margin-bottom:12px}`,
    `.plans-s{background:var(--panel);border-block:1px solid var(--line)}`,
    `.plans-s>.sec>ul{display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}`,
    `.plan{background:var(--bg);border:1px solid var(--line);padding:28px 26px 24px}`,
    `.plan h3{font:700 15px/22px var(--head);letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}`,
    `.price{font:800 clamp(34px,8vw,48px)/1.05 var(--head);font-variant-numeric:tabular-nums;margin-top:10px;color:var(--acc)}`,
    `.dashes{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}`,
    `.dashes li{position:relative;padding:3px 0 3px 28px;color:var(--mute)}`,
    `.dashes li::before{content:"";position:absolute;left:0;top:calc(.8em + 2px);width:16px;height:2px;background:var(--acc)}`,
    `.visit .grid{display:grid;gap:20px;grid-template-columns:minmax(0,1fr);padding-block:56px}`,
    `.visit .sec{padding:30px 26px;background:var(--panel);border:1px solid var(--line)}`,
    `.rows li{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-top:1px solid var(--line)}.rows li:first-child{border-top:0;padding-top:0}`,
    `.rows li span:first-child{font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:14px;color:var(--mute)}`,
    `.rows li span:last-child{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}`,
    `.map{display:block;width:100%;height:auto;max-height:200px;margin-bottom:18px;border:1px solid var(--line)}`,
    `.map .pin{fill:var(--acc)}`,
    `.lc address{font-size:18px;font-weight:600}`,
    `.pill{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 24px;margin-top:18px;border:2px solid var(--acc);color:#FFFFFF;text-decoration:none;font:700 15px/1 var(--head);letter-spacing:.06em;text-transform:uppercase}`,
    `.gl ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}.gl li:first-child{grid-column:1/-1}`,
    `.gl img{width:100%;height:100%;aspect-ratio:4/3;object-fit:cover;background:var(--panel)}`,
    `.rp{position:relative;background:var(--panel);border-block:1px solid var(--line);padding:64px 20px 56px;text-align:center}`,
    `.rp::before{content:"";position:absolute;top:0;left:50%;width:96px;height:5px;margin-left:-48px;background:var(--acc)}`,
    `.rp p{font:800 clamp(26px,6vw,40px)/1.05 var(--head);margin-bottom:22px}`,
    `.rp a{display:inline-flex;align-items:center;justify-content:center;min-height:56px;min-width:min(100%,280px);padding:0 32px;border:2px solid rgba(255,255,255,.92);background:var(--fill);color:var(--on-gym);text-decoration:none;font:800 18px/1 var(--head);letter-spacing:.04em}`,
    `.ft{background:#000000;border-top:1px solid var(--line);color:var(--mute);font-size:14px}`,
    `.ft .w{display:flex;flex-wrap:wrap;gap:0 24px;justify-content:space-between;align-items:center;padding-block:10px}`,
    `.ft a{display:inline-flex;align-items:center;min-height:44px;text-decoration:underline;color:#FFFFFF}`,
    // tablet
    `@media (min-width:641px){`,
    `.w{padding-inline:32px}`,
    `.hero{min-height:600px}`,
    `.tile{flex:0 1 auto;min-width:176px}`,
    `.plans-s>.sec>ul{grid-template-columns:repeat(auto-fit,minmax(260px,360px))}`,
    `.gl ul{grid-template-columns:repeat(3,minmax(0,1fr))}.gl li:first-child{grid-column:auto}`,
    `.visit .grid{grid-template-columns:repeat(2,minmax(0,1fr))}.visit .grid.one{grid-template-columns:minmax(0,560px)}`,
    `}`,
    // desktop
    `@media (min-width:1024px){`,
    `.hero{min-height:680px}`,
    `.hero::before{background:linear-gradient(90deg,rgba(7,8,13,.97) 0,rgba(7,8,13,.88) 38%,rgba(7,8,13,.35) 100%)}`,
    `.sec{padding-block:88px}`,
    `.duo{grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:64px}.ab.wide{grid-column:1/-1}`,
    `.visit .grid{padding-block:88px;gap:28px}`,
    `.gl ul{grid-template-columns:repeat(12,minmax(0,1fr))}`,
    `.gl li,.gl li:first-child{grid-column:span 3}`,
    `.gl li:first-child:nth-last-child(3),.gl li:first-child:nth-last-child(3)~li{grid-column:span 4}`,
    `.gl li:first-child:nth-last-child(2),.gl li:first-child:nth-last-child(2)~li{grid-column:span 6}`,
    `.gl li:only-child{grid-column:1/-1}`,
    `.gl li:first-child:nth-last-child(n+5){grid-column:span 6;grid-row:span 2}`,
    `.gl li:first-child:nth-last-child(n+5) img{aspect-ratio:auto}`,
    `}`,
    `@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`,
  ].join("\n");
}
