/**
 * Send-as-the-connected-account via the Gmail API. Distinct from and NOT
 * wired into notify.ts's existing Resend-based send path — that one
 * already works and covers every org regardless of whether they've
 * connected Google. This exists for the specific case a Trello-style
 * "connect your Gmail" adds: sending a task-related email that visibly
 * comes from a real person's real Gmail address (e.g. "forward this task
 * to a client"), not from a shared notifications@ sender.
 */

import { getGoogleAccessToken } from "./client";

const GMAIL_SEND_API = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export interface SendViaGmailInput {
  tenantId: string;
  to: string;
  subject: string;
  bodyText: string;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Throws if Google isn't connected for this org (unlike Calendar sync,
 * which silently skips) — sending an email is always a direct, explicit
 * user action here, so silently doing nothing would be surprising.
 */
export async function sendViaGmail(input: SendViaGmailInput): Promise<void> {
  const accessToken = await getGoogleAccessToken(input.tenantId);
  if (!accessToken) {
    throw new Error("Gmail no está conectado para esta organización.");
  }

  // Defense in depth against RFC 5322 header injection: `to` and `subject`
  // (the latter is often a user-controlled task title) end up as literal
  // header lines below, so a stray \r or \n could inject extra headers
  // (e.g. Bcc:) into the org's own outbound message. Callers should already
  // validate `to`; stripping here means this function is safe even if a
  // future caller doesn't.
  const safeTo = input.to.replace(/[\r\n]/g, "");
  const safeSubject = input.subject.replace(/[\r\n]/g, " ");

  const rawMessage = [
    `To: ${safeTo}`,
    `Subject: ${safeSubject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.bodyText,
  ].join("\r\n");

  const res = await fetch(GMAIL_SEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: base64UrlEncode(rawMessage) }),
  });

  if (!res.ok) {
    throw new Error(`Gmail rechazó el envío: ${await res.text()}`);
  }
}
