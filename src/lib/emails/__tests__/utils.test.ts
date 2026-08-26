/**
 * Email Utility Functions - Test Suite
 * Task 5: Email layouts and utilities
 */

import { formatDate, taskUrl, plainTextFallback, sanitizeForEmail } from '../utils';

describe('Email Utilities', () => {
  // ========================================================================
  // formatDate Tests
  // ========================================================================

  describe('formatDate', () => {
    it('should format date in short format correctly', () => {
      const date = new Date('2026-01-15T12:00:00');
      const result = formatDate(date, 'short');
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/\d+/);
    });

    it('should format date in long format correctly', () => {
      const date = new Date('2026-01-15T12:00:00');
      const result = formatDate(date, 'long');
      expect(result).toMatch(/January/);
      expect(result).toMatch(/2026/);
    });

    it('should handle string input (ISO date)', () => {
      const result = formatDate('2026-01-15T12:00:00Z', 'short');
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/\d+/);
    });

    it('should handle long format with ISO string', () => {
      const result = formatDate('2026-01-15T12:00:00Z', 'long');
      expect(result).toMatch(/January/);
      expect(result).toMatch(/2026/);
    });

    it('should default to long format when no format specified', () => {
      const result = formatDate('2026-01-15T12:00:00');
      expect(result).toMatch(/January/);
      expect(result).toMatch(/2026/);
    });

    it('should handle invalid date input gracefully', () => {
      const result = formatDate('invalid-date');
      expect(result).toBe('Invalid date');
    });

    it('should handle invalid date object gracefully', () => {
      const result = formatDate(new Date('invalid'));
      expect(result).toBe('Invalid date');
    });

    it('should format various months correctly in short format', () => {
      const testCases = [
        { date: '2026-01-15T12:00:00', expectedMonth: 'Jan' },
        { date: '2026-12-15T12:00:00', expectedMonth: 'Dec' },
        { date: '2026-06-15T12:00:00', expectedMonth: 'Jun' },
      ];

      testCases.forEach(({ date, expectedMonth }) => {
        const result = formatDate(date, 'short');
        expect(result).toContain(expectedMonth);
      });
    });
  });

  // ========================================================================
  // taskUrl Tests
  // ========================================================================

  describe('taskUrl', () => {
    it('should construct correct URL with default baseUrl', () => {
      const result = taskUrl('task-123', 'org-456');
      expect(result).toMatch(/\d+\.\d+\.\d+:\d+|localhost|http:\/\/.*\/orgs\/org-456\/tasks\/task-123/);
    });

    it('should construct correct URL with custom baseUrl', () => {
      const result = taskUrl('task-123', 'org-456', 'https://app.example.com');
      expect(result).toBe('https://app.example.com/orgs/org-456/tasks/task-123');
    });

    it('should match URL pattern /orgs/{orgId}/tasks/{taskId}', () => {
      const result = taskUrl('task-abc-123', 'org-xyz-789');
      expect(result).toMatch(/\/orgs\/org-xyz-789\/tasks\/task-abc-123$/);
    });

    it('should handle baseUrl with trailing slash', () => {
      const result = taskUrl('task-123', 'org-456', 'https://app.example.com/');
      expect(result).toContain('https://app.example.com/');
      expect(result).toContain('/orgs/org-456/tasks/task-123');
    });

    it('should handle various UUID formats', () => {
      const uuids = [
        { taskId: '123e4567-e89b-12d3-a456-426614174000', orgId: '987fcdeb-51a2-11ec-81d3-0242ac130003' },
        { taskId: 'simple-id-123', orgId: 'simple-org-456' },
      ];

      uuids.forEach(({ taskId, orgId }) => {
        const result = taskUrl(taskId, orgId);
        expect(result).toContain(`/orgs/${orgId}/tasks/${taskId}`);
      });
    });
  });

  // ========================================================================
  // plainTextFallback Tests
  // ========================================================================

  describe('plainTextFallback', () => {
    it('should remove HTML tags', () => {
      const html = '<p>Hello</p><div>World</div>';
      const result = plainTextFallback(html);
      // Tags are removed, with proper spacing preserved via newlines
      expect(result).toContain('Hello');
      expect(result).toContain('World');
      expect(result).not.toContain('<');
    });

    it('should decode HTML entities correctly', () => {
      const testCases = [
        { input: 'Hello &amp; goodbye', expected: '&' },
        { input: 'Price &lt; 50', expected: '<' },
        { input: 'Quote: &quot;Hello&quot;', expected: '"' },
        { input: 'Space&nbsp;here', expected: ' ' },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = plainTextFallback(input);
        expect(result).toContain(expected);
      });
    });

    it('should preserve link URLs after link text', () => {
      const html = '<a href="https://example.com">Click here</a>';
      const result = plainTextFallback(html);
      expect(result).toContain('Click here');
      expect(result).toContain('https://example.com');
    });

    it('should format link as text (url)', () => {
      const html = '<a href="http://example.com">Click</a>';
      const result = plainTextFallback(html);
      expect(result).toBe('Click (http://example.com)');
    });

    it('should handle multiple links', () => {
      const html = '<p><a href="http://a.com">Link A</a> and <a href="http://b.com">Link B</a></p>';
      const result = plainTextFallback(html);
      expect(result).toContain('Link A');
      expect(result).toContain('http://a.com');
      expect(result).toContain('Link B');
      expect(result).toContain('http://b.com');
    });

    it('should preserve paragraph spacing', () => {
      const html = '<p>Paragraph 1</p><p>Paragraph 2</p>';
      const result = plainTextFallback(html);
      expect(result).toContain('Paragraph 1');
      expect(result).toContain('Paragraph 2');
      expect(result).toContain('\n');
    });

    it('should normalize multiple spaces to single space', () => {
      const html = '<p>Hello    world</p>';
      const result = plainTextFallback(html);
      expect(result).toBe('Hello world');
    });

    it('should trim excess whitespace', () => {
      const html = '   <p>Text</p>   ';
      const result = plainTextFallback(html);
      expect(result).toBe('Text');
    });

    it('should handle complex HTML structure', () => {
      const html = `
        <div>
          <h1>Title</h1>
          <p>Hello &amp; welcome to <a href="https://taskflow.com">TaskFlow</a></p>
          <p>Best regards</p>
        </div>
      `;
      const result = plainTextFallback(html);
      expect(result).toContain('Title');
      expect(result).toContain('Hello & welcome');
      expect(result).toContain('TaskFlow');
      expect(result).toContain('https://taskflow.com');
      expect(result).toContain('Best regards');
    });

    it('should handle edge case: empty HTML', () => {
      const result = plainTextFallback('');
      expect(result).toBe('');
    });

    it('should handle edge case: only tags', () => {
      const result = plainTextFallback('<p></p><div></div>');
      expect(result).toBe('');
    });
  });

  // ========================================================================
  // sanitizeForEmail Tests
  // ========================================================================

  describe('sanitizeForEmail', () => {
    it('should encode < to &lt;', () => {
      const result = sanitizeForEmail('<script>');
      expect(result).toBe('&lt;script&gt;');
    });

    it('should encode > to &gt;', () => {
      const result = sanitizeForEmail('foo > bar');
      expect(result).toBe('foo &gt; bar');
    });

    it('should encode " to &quot;', () => {
      const result = sanitizeForEmail('Say "hello"');
      expect(result).toBe('Say &quot;hello&quot;');
    });

    it('should encode & to &amp;', () => {
      const result = sanitizeForEmail('A & B');
      expect(result).toBe('A &amp; B');
    });

    it('should encode single quotes to &#39;', () => {
      const result = sanitizeForEmail("It's");
      expect(result).toBe('It&#39;s');
    });

    it('should handle multiple special characters', () => {
      const input = '<script>alert("XSS")</script>';
      const result = sanitizeForEmail(input);
      expect(result).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
    });

    it('should preserve normal text', () => {
      const result = sanitizeForEmail('Hello World');
      expect(result).toBe('Hello World');
    });

    it('should handle mixed content', () => {
      const input = 'User said: "It\'s < 50 & safe"';
      const result = sanitizeForEmail(input);
      expect(result).toContain('&quot;');
      expect(result).toContain('&#39;');
      expect(result).toContain('&lt;');
      expect(result).toContain('&amp;');
    });

    it('should handle XSS prevention', () => {
      const xssAttempt = '<img src=x onerror="alert(1)">';
      const result = sanitizeForEmail(xssAttempt);
      // The dangerous characters should be escaped, making the XSS payload harmless
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
      expect(result).toContain('&quot;');
      // The result should not execute JavaScript when rendered as text
      expect(result).not.toContain('<img');
    });
  });

  // ========================================================================
  // Integration Tests
  // ========================================================================

  describe('Integration', () => {
    it('should handle complete email preparation workflow', () => {
      // Simulate preparing user-generated content for email
      const userInput = 'Check out <script>alert("xss")</script> for details';
      const sanitized = sanitizeForEmail(userInput);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('&lt;');
    });

    it('should format email with date and URL', () => {
      const formattedDate = formatDate('2026-08-17', 'short');
      const taskLink = taskUrl('task-id', 'org-id', 'https://app.example.com');
      expect(formattedDate).toBeTruthy();
      expect(taskLink).toContain('/orgs/org-id/tasks/task-id');
    });

    it('should convert complex HTML to plain text with links and entities', () => {
      const htmlEmail = `
        <div>
          <p>Hi User,</p>
          <p>Check out <a href="https://example.com/tasks/123">your task</a> &amp; let us know.</p>
        </div>
      `;
      const plainText = plainTextFallback(htmlEmail);
      expect(plainText).toContain('Hi User');
      expect(plainText).toContain('your task');
      expect(plainText).toContain('https://example.com/tasks/123');
      expect(plainText).toContain('&');
      expect(plainText).not.toContain('<');
    });
  });
});
