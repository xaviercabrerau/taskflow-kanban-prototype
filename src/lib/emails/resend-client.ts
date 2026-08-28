/**
 * Thin wrapper around the Resend SDK for sending notification emails.
 * RESEND_API_KEY is provisioned via the Vercel Marketplace integration.
 */

import { Resend } from 'resend';

let client: Resend | null = null;

function getClient(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not set — cannot send email notifications.');
    }
    client = new Resend(apiKey);
  }
  return client;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// No verified sending domain exists in the Resend account yet — falls back
// to Resend's own sandbox sender, which works without domain verification
// but is rate-limited and meant for testing. Set NOTIFICATION_FROM_EMAIL to
// an address on a verified domain before relying on this in production.
const FROM_ADDRESS = process.env.NOTIFICATION_FROM_EMAIL || 'TaskFlow <onboarding@resend.dev>';

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const { data, error } = await getClient().emails.send({
    from: FROM_ADDRESS,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  if (error || !data) {
    throw new Error(`Resend send failed: ${error?.message || 'unknown error'}`);
  }

  return { id: data.id };
}
