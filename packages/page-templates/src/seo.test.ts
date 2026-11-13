// Story 25.5: the shared crawler header set, and the 24.11 gym-host outputs unchanged (byte for byte).
import { describe, expect, it } from "vitest";
import { SEO_CACHE_CONTROL, renderRobots, renderSitemap, seoHeaders } from "./index";

const SET = {
  "Cache-Control": "public, s-maxage=300",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
};

describe("seoHeaders", () => {
  it("is the content type plus the one crawler set: 5 minute cache, CSP that allows nothing, base security headers, no cookie", () => {
    expect(seoHeaders("text/plain; charset=utf-8")).toEqual({ "Content-Type": "text/plain; charset=utf-8", ...SET });
    expect(seoHeaders("application/xml; charset=utf-8")["Content-Type"]).toBe("application/xml; charset=utf-8");
    expect(SEO_CACHE_CONTROL).toBe(SET["Cache-Control"]);
    expect(Object.keys(seoHeaders("x")).map((k) => k.toLowerCase())).not.toContain("set-cookie");
  });
});

describe("the gym-host sitemap and robots (24.11) are unchanged", () => {
  it("sitemap.xml", () => {
    expect(renderSitemap("fit", "gymosapps.com")).toEqual({
      status: 200,
      headers: { "Content-Type": "application/xml; charset=utf-8", ...SET },
      body: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://fit.gymosapps.com/</loc></url>\n</urlset>\n',
    });
  });
  it("robots.txt", () => {
    expect(renderRobots("fit", "localhost:3200")).toEqual({
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...SET },
      body: "User-agent: *\nAllow: /\n\nSitemap: http://fit.localhost:3200/sitemap.xml\n",
    });
  });
});
