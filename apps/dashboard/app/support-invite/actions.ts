"use server";

import {
  beginTotpEnrollment,
  cancelFactorReset,
  inspectInvite,
  setInvitePassword,
  verifyTotpAndActivate,
  type CancelResetResult,
  type EnrollResult,
  type InspectResult,
  type PasswordResult,
  type VerifyResult,
} from "@/services/supportInvite";

// Public by design (the invite link is the credential; see services/supportInvite.ts). Each action re-checks the invite.

export async function inspectSupportInvite(token: string): Promise<InspectResult> {
  return inspectInvite(token);
}

export async function setSupportInvitePassword(token: string, password: string): Promise<PasswordResult> {
  return setInvitePassword(token, password);
}

export async function beginSupportTotp(token: string, password: string): Promise<EnrollResult> {
  return beginTotpEnrollment(token, password);
}

export async function verifySupportTotp(token: string, factorId: string, code: string, password: string): Promise<VerifyResult> {
  return verifyTotpAndActivate(token, factorId, code, password);
}

/** Story 23.11: cancel a pending authenticator reset (the link token is the credential). */
export async function cancelSupportFactorReset(token: string): Promise<CancelResetResult> {
  return cancelFactorReset(token);
}
