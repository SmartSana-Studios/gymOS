import { afterEach, describe, expect, it, vi } from "vitest";
import { baseContent } from "@gymos/page-templates/src/conformance/fixtures";

vi.mock("@gymos/page-templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@gymos/page-templates")>()),
  renderPageAsync: vi.fn(async () => {
    throw Object.assign(new TypeError("GYM-SECRET text in a message"), {});
  }),
}));

import { handleGymSite } from "./handler";
import { readConfig } from "./env";
import { notFoundResponse } from "./notFound";

afterEach(() => vi.restoreAllMocks());

describe("a render error", () => {
  it("answers the uniform not-found and logs the error name only", async () => {
    const logs: [string, unknown][] = [];
    const r = await handleGymSite(
      { tenantName: "fit", tenantPath: "/", acceptLanguage: null },
      {
        config: { rootDomain: "gymosapps.com", mediaOrigin: "https://media.example.com", reportKey: undefined },
        readPage: async () => ({ template: "classic", schema_version: 1, content: baseContent() }),
        readRedirect: async () => null,
        submitReport: async () => "ok",
        log: (e, f) => logs.push([e, f]),
      },
    );
    expect(await r.text()).toBe(await notFoundResponse("gymosapps.com").text());
    expect(JSON.stringify(logs)).toBe('[["gym_site_render_error",{"name":"TypeError"}]]');
  });
});

describe("the root domain setting", () => {
  it("a scheme, a path or a space is refused with one JSON log line, and gym hosting is off", () => {
    for (const bad of ["https://gymosapps.com", "gymosapps.com/", "gymosapps.com/x", "gym os.com", "*.gymosapps.com"]) {
      const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(readConfig({ PUBLIC_SITE_ROOT_DOMAIN: bad, NODE_ENV: "development" }).rootDomain, bad).toBeUndefined();
      expect(err).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(err.mock.calls[0]![0]))).toEqual({ event: "gym_site_config_invalid", variable: "PUBLIC_SITE_ROOT_DOMAIN" });
      err.mockRestore();
    }
  });
  it("a bare host with or without a port is accepted", () => {
    expect(readConfig({ PUBLIC_SITE_ROOT_DOMAIN: "gymosapps.com" }).rootDomain).toBe("gymosapps.com");
    expect(readConfig({ PUBLIC_SITE_ROOT_DOMAIN: "localhost:3002" }).rootDomain).toBe("localhost:3002");
  });
});
