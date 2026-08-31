/**
 * Email Utility Functions
 * Task 5: Email layouts and utilities
 */

/**
 * formatDate
 * Formats a date for email display with optional timezone awareness.
 * @param date - Date object or ISO date string to format
 * @param format - Format style: 'short' (e.g., "Jan 15") or 'long' (e.g., "January 15, 2026")
 * @returns Formatted date string
 * @example
 * formatDate(new Date('2026-01-15'), 'short') // "Jan 15"
 * formatDate('2026-01-15T00:00:00Z', 'long')  // "January 15, 2026"
 */
export function formatDate(
  date: Date | string,
  format: 'short' | 'long' = 'long'
): string {
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;

    // Validate date
    if (isNaN(dateObj.getTime())) {
      return 'Invalid date';
    }

    const options: Intl.DateTimeFormatOptions =
      format === 'short'
        ? { month: 'short', day: 'numeric' }
        : { month: 'long', day: 'numeric', year: 'numeric' };

    return dateObj.toLocaleDateString('en-US', options);
  } catch {
    return 'Invalid date';
  }
}

/**
 * taskUrl
 * Constructs a deep link to a task in the TaskFlow application.
 * @param taskId - UUID of the task
 * @param organizationId - UUID of the organization
 * @param baseUrl - Base application URL (defaults to NEXT_PUBLIC_APP_URL or localhost:3000)
 * @returns Complete URL to the task
 * @example
 * taskUrl('task-123', 'org-456') // "http://localhost:3000/?task=task-123"
 */
export function taskUrl(
  taskId: string,
  // Kept for call-site compatibility (both callers pass it) and in case a
  // future multi-org-per-user UI needs it to route to the right org first;
  // unused today since tasks only ever open as a modal over the single
  // board a session is in (no dedicated per-org route exists).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  organizationId: string,
  baseUrl?: string
): string {
  const url = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${url}/?task=${taskId}`;
}

/**
 * plainTextFallback
 * Converts HTML email content to readable plain text.
 * Handles:
 * - HTML entity decoding (&nbsp;, &amp;, &quot;, etc.)
 * - Tag stripping
 * - Link URL preservation
 * - Paragraph spacing preservation
 * - Whitespace normalization
 * @param htmlContent - HTML email content
 * @returns Plain text version
 * @example
 * plainTextFallback('<p>Hello &amp; goodbye</p>') // "Hello & goodbye"
 * plainTextFallback('<a href="https://example.com">Click</a>') // "Click (https://example.com)"
 */
export function plainTextFallback(htmlContent: string): string {
  try {
    let text = htmlContent;

    // Add line breaks before block-level elements close tags to preserve spacing
    text = text.replace(/<\/(p|div|section|article|blockquote|h[1-6]|li)>/gi, '</$1>\n');

    // Decode HTML entities
    const entityMap: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' ',
      '&copy;': '©',
      '&reg;': '®',
      '&deg;': '°',
    };

    Object.entries(entityMap).forEach(([entity, char]) => {
      text = text.replace(new RegExp(entity, 'g'), char);
    });

    // Handle links: convert <a href="url">text</a> to "text (url)"
    text = text.replace(/<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi, '$2 ($1)');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Normalize whitespace: replace multiple spaces/newlines with single newline
    text = text.replace(/[ \t]+/g, ' '); // Replace multiple spaces/tabs with single space
    text = text.replace(/\n\s*\n/g, '\n\n'); // Replace multiple newlines with double newline (paragraph break)
    text = text.replace(/\n\s+/g, '\n'); // Remove trailing spaces from lines

    // Trim overall
    text = text.trim();

    return text;
  } catch {
    // Fallback: just strip tags if regex fails
    return htmlContent.replace(/<[^>]+>/g, '').trim();
  }
}

/**
 * sanitizeForEmail
 * Escapes special characters for safe email rendering.
 * Prevents XSS attacks by HTML-encoding unsafe characters.
 * @param text - Text to sanitize
 * @returns Safely encoded text
 * @example
 * sanitizeForEmail('<script>alert("xss")</script>') // "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
 */
export function sanitizeForEmail(text: string): string {
  const charMap: Record<string, string> = {
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '&': '&amp;',
  };

  return text.replace(/[<>"'&]/g, (char) => charMap[char] || char);
}
