/** Story 22.8: the mail sender is configured from env, fails closed, and never leaks recipients to logs. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fromHeader, smtpReason, createMailer, readMailConfig, type MailEnv } from "./mail";

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

describe("requireTLS", () => {
  it("is required whenever credentials are set or the host is not local, except on implicit TLS", () => {
    expect(readMailConfig(env)?.requireTLS).toBe(false); // 465 is already TLS
    expect(readMailConfig({ ...env, MAIL_SMTP_PORT: "587" })?.requireTLS).toBe(true);
    expect(readMailConfig({ MAIL_SMTP_HOST: "smtp.example.com", MAIL_SMTP_PORT: "25", MAIL_FROM: "a@b.c" })?.requireTLS).toBe(true);
    expect(readMailConfig({ MAIL_SMTP_HOST: "127.0.0.1", MAIL_SMTP_PORT: "54325", MAIL_FROM: "a@b.c" })?.requireTLS).toBe(false);
  });
  it("is passed to the transport", async () => {
    const factory = vi.fn(() => ({ sendMail: vi.fn(async () => ({})) }));
    await createMailer({ ...env, MAIL_SMTP_PORT: "587" }, factory)(message);
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ requireTLS: true }));
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

  it("logs the server's refusal text so the operator can see why, scrubbed of addresses and keys", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = "550 The gymosapps.com domain is not verified. Sent to r@rec.example with key re_AbC123_x-y";
    const factory = () => ({ sendMail: vi.fn(async () => { throw Object.assign(new Error("Message failed: r@rec.example"), { code: "EMESSAGE", response }); }) });
    expect(await createMailer(env, factory)(message)).toEqual({ ok: false, reason: "send_failed" });
    expect(log).toHaveBeenCalledWith("[mail] send failed", "EMESSAGE", "550 The gymosapps.com domain is not verified. Sent to [address] with key [key]");
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("rec.example");
    expect(logged).not.toContain("re_AbC123");
    expect(logged).not.toContain("Message failed");
  });

  it("also survives a transport that cannot even be created", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const factory = () => { throw new Error("boom"); };
    expect(await createMailer(env, factory)(message)).toEqual({ ok: false, reason: "send_failed" });
  });
});

describe("smtpReason", () => {
  it("is empty when the error has no server response", () => {
    expect(smtpReason(new Error("x"))).toBe("");
    expect(smtpReason(null)).toBe("");
    expect(smtpReason({ response: 5 })).toBe("");
  });
  it("collapses whitespace and caps the length", () => {
    expect(smtpReason({ response: "550   a\n b" })).toBe("550 a b");
    expect(smtpReason({ response: "x".repeat(500) })).toHaveLength(200);
  });
});

describe("From display name", () => {
  it("is optional: without MAIL_FROM_NAME the From value is passed through unchanged", () => {
    const c = readMailConfig({ ...env, MAIL_FROM: "hello@gymosapps.com" })!;
    expect(c.fromName).toBeUndefined();
    expect(fromHeader(c)).toBe("hello@gymosapps.com");
  });
  it("builds {name, address} from MAIL_FROM_NAME and a bare MAIL_FROM", () => {
    const c = readMailConfig({ ...env, MAIL_FROM: "hello@gymosapps.com", MAIL_FROM_NAME: " GymOS " })!;
    expect(fromHeader(c)).toEqual({ name: "GymOS", address: "hello@gymosapps.com" });
  });
  it("takes just the address out of a 'Name <address>' MAIL_FROM when a name is set", () => {
    const c = readMailConfig({ ...env, MAIL_FROM: "Old Name <hello@gymosapps.com>", MAIL_FROM_NAME: "GymOS" })!;
    expect(fromHeader(c)).toEqual({ name: "GymOS", address: "hello@gymosapps.com" });
  });
  it("ignores a name containing a line break", () => {
    const c = readMailConfig({ ...env, MAIL_FROM: "hello@gymosapps.com", MAIL_FROM_NAME: "GymOS\r\nBcc: x@y.z" })!;
    expect(c.fromName).toBeUndefined();
  });
  it("is what the transport receives", async () => {
    const sendMail = vi.fn(async () => ({}));
    await createMailer({ ...env, MAIL_FROM: "hello@gymosapps.com", MAIL_FROM_NAME: "GymOS" }, () => ({ sendMail }))(message);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: "GymOS", address: "hello@gymosapps.com" } }));
  });
});
