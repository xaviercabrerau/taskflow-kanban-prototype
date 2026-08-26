/**
 * Email System Type Definitions
 * Task 5: Email layouts and utilities
 */

/**
 * EmailTemplate
 * Represents a rendered email with both HTML and plain text versions.
 * Used as the output of email template rendering pipeline.
 */
export interface EmailTemplate {
  /** Email recipient address */
  subject: string;

  /** HTML email body for email clients */
  htmlBody: string;

  /** Plain text fallback for email clients without HTML support */
  textBody: string;

  /** Recipient email address */
  recipientEmail: string;
}

/**
 * EmailRenderOptions
 * Configuration options for email rendering.
 * Controls how emails are processed and generated.
 */
export interface EmailRenderOptions {
  /** Whether to inline critical CSS for email client compatibility */
  inlineCss?: boolean;

  /** Whether to generate only plain text output (skip HTML) */
  plainTextOnly?: boolean;
}
