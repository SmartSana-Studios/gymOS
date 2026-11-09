// The Classic template's ONE inline style block (hashed in the CSP). Mobile first, three CSS-only layouts (under 641, 641 to 1023, 1024 and
// up), identical DOM at every width. No external stylesheet, no style attribute, no @import, no url() to another origin. The gym colour is
// reached only through the four custom properties of :root; nothing else from the gym ever enters CSS.
import type { GymColors } from "../../contract";
import { FONT_ALLOWLIST } from "../../contract";

export const CLASSIC_FONTS = ["barlow-700", "barlow-800"] as const;

export function classicCss(colors: GymColors): string {
  const faces = CLASSIC_FONTS.map((id) => {
    const f = FONT_ALLOWLIST[id];
    return `@font-face{font-family:${f.family};font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${f.path}) format("woff2")}`;
  }).join("");
  return [
    `:root{--gym:${colors.gym};--ui:${colors.ui};--fill:${colors.fill};--on-gym:${colors.on};--ink:#1B2A41;--muted:#4B5563;--bg:#F3F4F0;--card:#FFFFFF;--line:#E6E4DD;--chip:#ECEEE8;--shadow:0 1px 2px rgba(27,42,65,.06),0 10px 28px rgba(27,42,65,.07);--head:Barlow,"Helvetica Neue",Arial,system-ui,sans-serif;--body:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}`,
    faces,
    `*,*::before,*::after{box-sizing:border-box}`,
    `html{-webkit-text-size-adjust:100%;text-size-adjust:100%}`,
    `body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--body);overflow-wrap:anywhere}`,
    `h1,h2,h3,p,ul,address{margin:0}ul{padding:0;list-style:none}address{font-style:normal}`,
    `img{display:block;max-width:100%}a{color:inherit}`,
    `a:focus-visible,summary:focus-visible{outline:3px solid var(--ui);outline-offset:2px}`,
    `main{display:contents}`,
    // layout: mobile, one column; every grid item has class i
    `.page{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;padding-bottom:40px}`,
    `.i{min-width:0}.i:not(.bn){margin-inline:16px}`,
    `.card{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px}`,
    `.bn{grid-row:1;aspect-ratio:2/1;background:#D9DBD3;overflow:hidden}`,
    `.bn img{width:100%;height:100%;object-fit:cover}`,
    `.hd{grid-row:2;position:relative;z-index:1;margin-top:-72px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px}`,
    `.nb .hd{margin-top:0;grid-row:1}`,
    `.logo{flex:none;width:72px;height:72px;border-radius:50%;border:3px solid var(--ui);background:var(--card);overflow:hidden}`,
    `.logo img{width:100%;height:100%;object-fit:cover}`,
    `.id{flex:1 1 160px;min-width:0}`,
    `.id h1{font:800 24px/28px var(--head);letter-spacing:.2px}`,
    `.chip{display:inline-block;background:var(--chip);border-radius:8px;padding:2px 10px;font-size:14px;font-weight:600;margin-top:6px}`,
    `.loc{color:var(--muted);font-size:14px;margin-top:4px}`,
    `.lang{margin-left:auto}`,
    `.lang a,.lang summary{display:inline-flex;align-items:center;min-height:44px;min-width:44px;padding:0 4px;font-weight:600;text-decoration:underline;cursor:pointer}`,
    `.lang details{position:relative}.lang ul{position:absolute;right:0;z-index:2;min-width:160px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:4px 12px}`,
    `.lang li{display:flex;align-items:center;min-height:44px}.lang [aria-current]{font-weight:800}`,
    // contact
    `.ct{display:grid;gap:8px}`,
    `.tiles{display:flex;gap:8px}`,
    `.tile{flex:1 1 0;min-width:0;min-height:84px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:10px 6px;border-radius:16px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);text-decoration:none;font-weight:700;font-size:15px;text-align:center}`,
    `.tile svg{width:28px;height:28px;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}`,
    `.tile.call{background:var(--fill);color:var(--on-gym);border-color:var(--fill)}`,
    `.nums{display:grid;gap:2px;justify-items:center;text-align:center;font-weight:600}.nums span{color:var(--muted);font-weight:500;margin-inline-end:6px}`,
    // sections
    `.sec h2{font:700 22px/24px var(--head);margin-bottom:12px}`,
    `.ab p{max-width:62ch}.ab p+p{margin-top:12px}`,
    `.chips{display:flex;flex-wrap:wrap;gap:8px}.chips li{background:var(--chip);border-radius:8px;padding:6px 12px;font-weight:500}`,
    `.plans>ul{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}`,
    `.plan h3{font:700 19px/24px var(--head)}`,
    `.price{font:800 24px/28px var(--head);font-variant-numeric:tabular-nums;margin-top:8px}`,
    `.plan .chips{margin-top:10px}.plan .chips li{font-size:14px;padding:4px 10px}`,
    `.rows li{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-top:1px solid var(--line)}.rows li:first-child{border-top:0;padding-top:0}`,
    `.rows li span:last-child{text-align:right;font-variant-numeric:tabular-nums}`,
    `.map{display:block;width:100%;height:auto;border-radius:12px;margin-bottom:12px}`,
    `.map .pin{fill:var(--ui)}`,
    `.pill{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;margin-top:12px;border-radius:999px;border:2px solid var(--ink);text-decoration:none;font-weight:700}`,
    `.gl ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.gl li:first-child{grid-column:1/-1}`,
    `.gl img{width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:12px;background:#D9DBD3}`,
    `.rp a{display:flex;align-items:center;justify-content:center;min-height:56px;border-radius:999px;background:var(--fill);color:var(--on-gym);text-decoration:none;font:700 18px/24px var(--head)}`,
    `.ft{display:flex;flex-wrap:wrap;gap:0 24px;justify-content:space-between;align-items:center;color:var(--muted);font-size:14px}`,
    `.ft a{display:inline-flex;align-items:center;min-height:44px;text-decoration:underline}`,
    // tablet
    `@media (min-width:641px){`,
    `.page{grid-template-columns:repeat(2,minmax(0,1fr));max-width:800px;margin:0 auto;padding:16px 16px 40px}`,
    `.i:not(.bn){margin-inline:0}.i{grid-column:1/-1}`,
    `.bn{border-radius:12px;aspect-ratio:3/1}`,
    `.hd{margin-top:-64px}.nb .hd{margin-top:0}`,
    `.hr{grid-column:1}.lc{grid-column:2}.i.wide{grid-column:1/-1}`,
    `.plans>ul{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}`,
    `.gl ul{grid-template-columns:repeat(3,minmax(0,1fr))}.gl li:first-child{grid-column:auto}`,
    `.rp a{max-width:280px;margin-inline:auto}`,
    `}`,
    // desktop
    `@media (min-width:1024px){`,
    `.page{max-width:1120px}`,
    `.bn{aspect-ratio:4/1}`,
    `.hd{grid-column:1;grid-row:2;margin-top:-72px;gap:8px 20px}.nb .hd{margin-top:0}`,
    `.ct{grid-column:2;grid-row:2;margin-top:-72px;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px;align-content:center}`,
    `.nb .ct{margin-top:0;grid-row:1}`,
    `.ct .tile{box-shadow:none}`,
    `.logo{width:96px;height:96px}`,
    `.id h1{font-size:28px;line-height:36px}`,
    `.ab{grid-column:1}.sv{grid-column:2}.i.wide{grid-column:1/-1}`,
    `.plans>ul{grid-template-columns:repeat(3,minmax(0,1fr))}`,
    `.gl ul{grid-template-columns:repeat(4,minmax(0,1fr))}`,
    `}`,
  ].join("\n");
}
