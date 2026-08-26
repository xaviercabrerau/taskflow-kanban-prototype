/**
 * Email Layout Components
 * Task 5: Email layouts and utilities
 * Uses react-email for email template rendering
 */

import React from 'react';
import {
  Body,
  Button,
  Column,
  Container,
  Font,
  Head,
  Hr,
  Html,
  Link,
  Row,
  Section,
  Text,
} from 'react-email';
import { render } from '@react-email/render';

// ============================================================================
// BaseLayout Component
// ============================================================================

interface BaseLayoutProps {
  /** Email body content */
  children: React.ReactNode;

  /** Recipient name for personalization */
  recipientName?: string;

  /** Organization name for header */
  organizationName?: string;
}

/**
 * BaseLayout
 * Master email wrapper with header, body, and footer.
 * Uses TaskFlow brand colors and responsive 600px container.
 * @param props - Layout configuration
 * @returns Rendered email HTML component
 */
export function BaseLayout({
  children,
  recipientName,
  organizationName = 'TaskFlow',
}: BaseLayoutProps): React.ReactElement {
  return (
    <Html>
      <Head>
        <Font
          fontFamily="Inter"
          fallbackFontFamily="sans-serif"
          webFont={{
            url: 'https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHAPMtMV7hQ.woff2',
            format: 'woff2',
          }}
        />
      </Head>
      <Body
        style={{
          backgroundColor: '#f3f4f6',
          fontFamily: 'Inter, sans-serif',
          fontSize: '14px',
          lineHeight: '1.6',
          color: '#374151',
        }}
      >
        <Container
          style={{
            maxWidth: '600px',
            margin: '0 auto',
            paddingTop: '20px',
            paddingBottom: '20px',
          }}
        >
          {/* Header */}
          <Section
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px 8px 0 0',
              paddingTop: '30px',
              paddingBottom: '30px',
              paddingLeft: '30px',
              paddingRight: '30px',
              borderBottom: '1px solid #e5e7eb',
            }}
          >
            <Row>
              <Column>
                <Text
                  style={{
                    margin: '0',
                    fontSize: '18px',
                    fontWeight: '700',
                    color: '#3b82f6',
                  }}
                >
                  {organizationName}
                </Text>
              </Column>
            </Row>
          </Section>

          {/* Body */}
          <Section
            style={{
              backgroundColor: '#ffffff',
              paddingTop: '30px',
              paddingBottom: '30px',
              paddingLeft: '30px',
              paddingRight: '30px',
            }}
          >
            {recipientName && (
              <Text
                style={{
                  margin: '0 0 20px 0',
                  fontSize: '14px',
                  color: '#6b7280',
                }}
              >
                Hi {recipientName},
              </Text>
            )}
            {children}
          </Section>

          {/* Footer */}
          <Section
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '0 0 8px 8px',
              paddingTop: '30px',
              paddingBottom: '30px',
              paddingLeft: '30px',
              paddingRight: '30px',
              borderTop: '1px solid #e5e7eb',
              textAlign: 'center',
            }}
          >
            <Hr style={{ borderColor: '#e5e7eb', margin: '20px 0' }} />

            <Text
              style={{
                margin: '10px 0',
                fontSize: '12px',
                color: '#9ca3af',
              }}
            >
              You received this email because you&apos;re part of a TaskFlow organization.
            </Text>

            <Text
              style={{
                margin: '10px 0',
                fontSize: '12px',
                color: '#9ca3af',
              }}
            >
              <Link
                href="#"
                style={{
                  color: '#3b82f6',
                  textDecoration: 'underline',
                }}
              >
                Unsubscribe from this notification
              </Link>
            </Text>

            <Text
              style={{
                margin: '20px 0 0 0',
                fontSize: '11px',
                color: '#d1d5db',
              }}
            >
              © 2026 TaskFlow. All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ============================================================================
// TaskNotificationLayout Component
// ============================================================================

interface TaskNotificationLayoutProps {
  /** Email body content */
  children: React.ReactNode;

  /** Email subject line */
  subject: string;

  /** Task title for badge/header */
  taskTitle: string;

  /** Deep link to task in application */
  taskUrl: string;
}

/**
 * TaskNotificationLayout
 * Extends BaseLayout with task-specific header containing:
 * - Task title linked to task
 * - Subject line
 * - Action button for quick access
 * @param props - Layout configuration
 * @returns Rendered email HTML component
 */
export function TaskNotificationLayout({
  children,
  subject,
  taskTitle,
  taskUrl,
}: TaskNotificationLayoutProps): React.ReactElement {
  return (
    <BaseLayout organizationName="TaskFlow">
      {/* Task Header */}
      <Section
        style={{
          backgroundColor: '#f0f9ff',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px',
          borderLeft: '4px solid #3b82f6',
        }}
      >
        <Text
          style={{
            margin: '0 0 10px 0',
            fontSize: '12px',
            fontWeight: '700',
            color: '#3b82f6',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Task Notification
        </Text>

        <Link
          href={taskUrl}
          style={{
            color: '#1e40af',
            textDecoration: 'none',
            fontSize: '16px',
            fontWeight: '600',
            display: 'block',
            marginBottom: '8px',
          }}
        >
          {taskTitle}
        </Link>

        <Text
          style={{
            margin: '0',
            fontSize: '14px',
            color: '#374151',
          }}
        >
          {subject}
        </Text>
      </Section>

      {/* Content */}
      {children}

      {/* Action Button */}
      <Section
        style={{
          marginTop: '30px',
          textAlign: 'center',
        }}
      >
        <Button
          href={taskUrl}
          style={{
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            padding: '12px 30px',
            borderRadius: '6px',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: '600',
            display: 'inline-block',
            border: '1px solid #3b82f6',
          }}
        >
          View Task
        </Button>
      </Section>
    </BaseLayout>
  );
}

// ============================================================================
// RenderEmail Utility Function
// ============================================================================

interface RenderEmailResult {
  /** HTML email body */
  html: string;

  /** Plain text email body */
  text: string;
}

/**
 * RenderEmail
 * Renders a React Email component to static HTML and plain text.
 * Handles:
 * - JSX to HTML conversion
 * - Plain text fallback generation
 * - CSS inlining (for email client compatibility)
 * @param component - React Email component to render
 * @returns Promise resolving to HTML and text versions
 * @example
 * const result = await RenderEmail(<BaseLayout>Hello</BaseLayout>);
 * console.log(result.html); // Full HTML
 * console.log(result.text); // Plain text version
 */
export async function RenderEmail(
  component: React.ReactElement
): Promise<RenderEmailResult> {
  try {
    // Render component to HTML
    const html = await render(component);

    // Generate plain text by stripping HTML tags and decoding entities
    const text = plainTextFromHtml(html);

    return { html, text };
  } catch (error) {
    console.error('RenderEmail error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to render email: ${errorMessage}`
    );
  }
}

/**
 * plainTextFromHtml
 * Internal helper to convert HTML email to readable plain text.
 * @param html - HTML content
 * @returns Plain text version
 */
function plainTextFromHtml(html: string): string {
  let text = html;

  // Decode common HTML entities
  const entityMap: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };

  Object.entries(entityMap).forEach(([entity, char]) => {
    text = text.replace(new RegExp(entity, 'g'), char);
  });

  // Handle links: <a href="url">text</a> → text (url)
  text = text.replace(/<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi, '$2 ($1)');

  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  text = text.replace(/\n\s+/g, '\n');

  // Trim
  text = text.trim();

  return text;
}
