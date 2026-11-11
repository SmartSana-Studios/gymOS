import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SUPABASE_ROOT_CA_2021, SUPABASE_ROOT_CA_2021_FINGERPRINT_SHA256 } from "./supabaseCa";
import { readerSsl } from "./db";

// Epic 24 retro G1: the reader verifies the pooler's certificate against this one pinned root.
describe("the pinned Supabase root CA", () => {
  const cert = new X509Certificate(SUPABASE_ROOT_CA_2021);
  it("is the Supabase Root 2021 CA with the recorded fingerprint", () => {
    expect(cert.subject).toContain("CN=Supabase Root 2021 CA");
    expect(cert.fingerprint256).toBe(SUPABASE_ROOT_CA_2021_FINGERPRINT_SHA256);
  });
  it("is a self-signed CA, not a leaf", () => {
    expect(cert.ca).toBe(true);
    expect(cert.checkIssued(cert)).toBe(true);
  });
  it("is the only certificate in the constant", () => {
    expect(SUPABASE_ROOT_CA_2021.match(/BEGIN CERTIFICATE/g)).toHaveLength(1);
  });
});

describe("readerSsl", () => {
  it("a remote host verifies the server certificate against the pinned root", () => {
    expect(readerSsl("aws-0-eu-west-1.pooler.supabase.com")).toEqual({ ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true });
  });
  it("only a local stack runs without TLS", () => {
    for (const h of ["localhost", "127.0.0.1", "::1", "host.docker.internal"]) expect(readerSsl(h)).toBe(false);
    expect(readerSsl("db.example.com")).not.toBe(false);
  });
});
