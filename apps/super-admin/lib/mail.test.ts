/** Story 22.8: the mail sender is configured from env, fails closed, and never leaks recipients to logs. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMailer, readMailConfig, type MailEnv } from "./mail";

const env: MailEnv = { MAIL_SMTP_HOST: "smtp.resend.com", MAIL_SMTP_PORT: "465", MAIL_SMTP_USER: "resend", MAIL_SMTP_PASS: "re_key", MAIL_FROM: "GymOS Security <security@gymosapps.com>" };
const message = { to: "r@rec.example", subject: "Your code", text: "123456" };

afterEach(() => vi.restoreAllMocks());

describe("readMailConfig", () => {
  it("is null without a host or a from address", () => {
    expect(readMailConfig({})).toBeNull();
    expect(readMailConfig({ MAIL_SMTP_HOST: "h" })).toBeNull();
    expect(readMailConfig({ MAIL_FROM: "a@b.c" })).toBeNull();
  });
  it("rejects a bad port", () => {
    expect(readMailConfig({ ...env, MAIL_SMTP_PORT: "abc" })).toBeNull();
    expect(readMailConfig({ ...env, MAIL_SMTP_PORT: "70000" })).toBeNull();
  });
  it("uses implicit TLS on 465 only, and no auth when none is set (local Inbucket)", () => {
    expect(readMailConfig(env)?.secure).toBe(true);
    const local = readMailConfig({ MAIL_SMTP_HOST: "127.0.0.1", MAIL_SMTP_PORT: "54325", MAIL_FROM: "a@b.c" });
    expect(local?.secure).toBe(false);
    expect(local?.auth).toBeUndefined();
  });
});

describe("createMailer", () => {
  it("does not send and says so when unconfigured", async () => {
    const factory = vi.fn();
    expect(await createMailer({}, factory)(message)).toEqual({ ok: false, reason: "not_configured" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("sends through the configured transport", async () => {
    const sendMail = vi.fn(async () => ({}));
    const factory = vi.fn(() => ({ sendMail }));
    expect(await createMailer(env, factory)(message)).toEqual({ ok: true });
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.resend.com", port: 465, secure: true, auth: { user: "resend", pass: "re_key" } }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: env.MAIL_FROM, to: "r@rec.example", subject: "Your code", text: "123456" }));
  });

  it("refuses a malformed recipient or a header-injection attempt before connecting", async () => {
    const factory = vi.fn();
    const send = createMailer(env, factory);
    for (const bad of [{ to: "not-an-email" }, { to: "a@b.c\r\nBcc: x@y.z" }, { subject: "hi\nBcc: x@y.z" }, { text: "" }, { to: "a@b.c, d@e.f" }]) {
      expect(await send({ ...message, ...bad })).toEqual({ ok: false, reason: "invalid_message" });
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it("returns send_failed, never throws, and logs only the error code, not the recipient", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const factory = () => ({ sendMail: vi.fn(async () => { throw Object.assign(new Error("550 no such user r@rec.example"), { code: "EENVELOPE" }); }) });
    expect(await createMailer(env, factory)(message)).toEqual({ ok: false, reason: "send_failed" });
    expect(log).toHaveBeenCalledWith("[mail] send failed", "EENVELOPE");
    expect(JSON.stringify(log.mock.calls)).not.toContain("rec.example");
  });

  it("also survives a transport that cannot even be created", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const factory = () => { throw new Error("boom"); };
    expect(await createMailer(env, factory)(message)).toEqual({ ok: false, reason: "send_failed" });
  });
});
