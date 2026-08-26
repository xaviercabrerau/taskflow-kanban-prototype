/**
 * Email Templates Test Suite
 * Task 6: Comprehensive tests for all 8 email template components
 * Tests component creation, props handling, and structure validation
 */

import {
  TaskAssignedTemplate,
  TaskMentionedTemplate,
  StatusChangedTemplate,
  DueSoonTemplate,
  CommentAddedTemplate,
  ProjectCreatedTemplate,
  MemberInvitedTemplate,
  TaskCompletedTemplate,
  type TemplateProps,
} from '../templates';
import { sanitizeForEmail } from '../utils';

// ============================================================================
// Test Data
// ============================================================================

const baseProps: TemplateProps = {
  recipientName: 'John Doe',
  organizationName: 'Acme Corp',
  taskTitle: 'Complete project proposal',
  taskUrl: 'http://localhost:3000/orgs/org-123/tasks/task-456',
  actorName: 'Jane Smith',
};

/**
 * Utility function to extract text content from JSX element recursively
 */
function extractText(element: unknown): string {
  if (typeof element === 'string') {
    return element;
  }
  if (Array.isArray(element)) {
    return element.map(extractText).join('');
  }
  if (
    element &&
    typeof element === 'object' &&
    'props' in element &&
    element.props &&
    typeof element.props === 'object' &&
    'children' in element.props
  ) {
    const children = (element.props as { children: unknown }).children;
    if (Array.isArray(children)) {
      return children.map(extractText).join('');
    }
    return extractText(children);
  }
  return '';
}

// ============================================================================
// 1. TaskAssignedTemplate Tests
// ============================================================================

describe('TaskAssignedTemplate', () => {
  test('renders without errors', () => {
    const element = TaskAssignedTemplate(baseProps);
    expect(element).toBeDefined();
    expect(element.type).toBeDefined();
  });

  test('renders with required props', () => {
    const element = TaskAssignedTemplate(baseProps);
    const text = extractText(element);
    expect(text).toContain('Complete project proposal');
    expect(text).toContain('Jane Smith');
    expect(text).toContain('Acme Corp');
  });

  test('renders with minimal props', () => {
    const minimalProps: TemplateProps = {
      recipientName: 'John',
      organizationName: 'Acme',
      taskTitle: 'Task',
      taskUrl: 'http://localhost:3000/orgs/org-1/tasks/task-1',
    };
    const element = TaskAssignedTemplate(minimalProps);
    expect(element).toBeDefined();
    const text = extractText(element);
    expect(text).toContain('assigned you');
  });

  test('contains actor name or fallback', () => {
    const element = TaskAssignedTemplate(baseProps);
    const text = extractText(element);
    expect(text).toMatch(/Jane Smith|A team member/);
  });

  test('sanitizes task title', () => {
    const xssProps: TemplateProps = {
      ...baseProps,
      taskTitle: '<script>alert("xss")</script>',
    };
    const element = TaskAssignedTemplate(xssProps);
    const text = extractText(element);
    expect(text).not.toContain('<script>');
  });

  test('sanitizes actor name', () => {
    const xssProps: TemplateProps = {
      ...baseProps,
      actorName: '"><img src=x onerror="alert()">',
    };
    const element = TaskAssignedTemplate(xssProps);
    const text = extractText(element);
    // Should not contain raw unescaped HTML tags
    expect(text).not.toContain('<img');
  });
});

// ============================================================================
// 2. TaskMentionedTemplate Tests
// ============================================================================

describe('TaskMentionedTemplate', () => {
  test('renders without errors', () => {
    const element = TaskMentionedTemplate(baseProps);
    expect(element).toBeDefined();
  });

  test('contains mentioned indicator', () => {
    const element = TaskMentionedTemplate(baseProps);
    const text = extractText(element);
    expect(text).toContain('mentioned you');
  });

  test('contains actor name', () => {
    const element = TaskMentionedTemplate(baseProps);
    const text = extractText(element);
    expect(text).toContain('Jane Smith');
  });

  test('contains task title', () => {
    const element = TaskMentionedTemplate(baseProps);
    const text = extractText(element);
    expect(text).toContain('Complete project proposal');
  });
});

// ============================================================================
// 3. StatusChangedTemplate Tests
// ============================================================================

describe('StatusChangedTemplate', () => {
  test('renders without errors', () => {
    const props = { ...baseProps, statusBefore: 'backlog', statusAfter: 'in_progress' };
    const element = StatusChangedTemplate(props);
    expect(element).toBeDefined();
  });

  test('contains status change information', () => {
    const props = { ...baseProps, statusBefore: 'backlog', statusAfter: 'in_progress' };
    const element = StatusChangedTemplate(props);
    const text = extractText(element);
    expect(text).toContain('backlog');
    expect(text).toContain('in_progress');
  });

  test('contains checkmark for done status', () => {
    const props = { ...baseProps, statusBefore: 'review', statusAfter: 'done' };
    const element = StatusChangedTemplate(props);
    const text = extractText(element);
    expect(text).toContain('done');
    expect(text).toContain('✓');
  });

  test('handles missing statuses gracefully', () => {
    const props = { ...baseProps };
    const element = StatusChangedTemplate(props);
    expect(element).toBeDefined();
  });
});

// ============================================================================
// 4. DueSoonTemplate Tests
// ============================================================================

describe('DueSoonTemplate', () => {
  test('renders without errors', () => {
    const props = { ...baseProps, dueDate: '2026-01-15' };
    const element = DueSoonTemplate(props);
    expect(element).toBeDefined();
  });

  test('contains due soon reminder', () => {
    const props = { ...baseProps, dueDate: '2026-01-15' };
    const element = DueSoonTemplate(props);
    const text = extractText(element);
    expect(text).toContain('is due');
  });

  test('contains urgency indicator', () => {
    const props = { ...baseProps, dueDate: '2026-01-15' };
    const element = DueSoonTemplate(props);
    const text = extractText(element);
    expect(text).toContain('Due Soon');
    expect(text).toContain('⏰');
  });

  test('renders without due date', () => {
    const element = DueSoonTemplate(baseProps);
    const text = extractText(element);
    expect(text).toContain('is due');
  });
});

// ============================================================================
// 5. CommentAddedTemplate Tests
// ============================================================================

describe('CommentAddedTemplate', () => {
  test('renders without errors', () => {
    const props = { ...baseProps, commentText: 'This looks great!' };
    const element = CommentAddedTemplate(props);
    expect(element).toBeDefined();
  });

  test('contains comment preview', () => {
    const props = { ...baseProps, commentText: 'This is a test comment' };
    const element = CommentAddedTemplate(props);
    const text = extractText(element);
    expect(text).toContain('This is a test comment');
  });

  test('truncates long comments', () => {
    const longComment = 'a'.repeat(250);
    const props = { ...baseProps, commentText: longComment };
    const element = CommentAddedTemplate(props);
    const text = extractText(element);
    expect(text).toContain('...');
  });

  test('handles missing comment text', () => {
    const element = CommentAddedTemplate(baseProps);
    const text = extractText(element);
    expect(text).toContain('commented');
  });

  test('sanitizes comment text for XSS', () => {
    const props = {
      ...baseProps,
      commentText: '<img src=x onerror="alert()">',
    };
    const element = CommentAddedTemplate(props);
    const text = extractText(element);
    // Should not contain raw unescaped HTML tags
    expect(text).not.toContain('<img');
  });
});

// ============================================================================
// 6. ProjectCreatedTemplate Tests
// ============================================================================

describe('ProjectCreatedTemplate', () => {
  test('renders without errors', () => {
    const props = { ...baseProps, projectName: 'Q1 Roadmap' };
    const element = ProjectCreatedTemplate(props);
    expect(element).toBeDefined();
  });

  test('contains project name', () => {
    const props = { ...baseProps, projectName: 'Q1 Roadmap' };
    const element = ProjectCreatedTemplate(props);
    const text = extractText(element);
    expect(text).toContain('Q1 Roadmap');
  });

  test('contains project creation message', () => {
    const props = { ...baseProps, projectName: 'New Project' };
    const element = ProjectCreatedTemplate(props);
    const text = extractText(element);
    expect(text).toContain('New Project Created');
  });

  test('contains View Project button text', () => {
    const props = { ...baseProps, projectName: 'Project' };
    const element = ProjectCreatedTemplate(props);
    const text = extractText(element);
    expect(text).toContain('View Project');
  });

  test('sanitizes project name', () => {
    const props = {
      ...baseProps,
      projectName: 'Project<img src=x onerror="alert()">',
    };
    const element = ProjectCreatedTemplate(props);
    const text = extractText(element);
    // Should not contain raw unescaped HTML tags
    expect(text).not.toContain('<img');
  });
});

// ============================================================================
// 7. MemberInvitedTemplate Tests
// ============================================================================

describe('MemberInvitedTemplate', () => {
  test('renders without errors', () => {
    const props = { ...baseProps, invitationAcceptUrl: 'http://localhost:3000/invite/abc123' };
    const element = MemberInvitedTemplate(props);
    expect(element).toBeDefined();
  });

  test('contains invitation header', () => {
    const props = { ...baseProps, invitationAcceptUrl: 'http://localhost:3000/invite/abc123' };
    const element = MemberInvitedTemplate(props);
    const text = extractText(element);
    expect(text).toContain('Invited');
  });

  test('contains Accept Invitation button', () => {
    const props = { ...baseProps, invitationAcceptUrl: 'http://localhost:3000/invite/abc123' };
    const element = MemberInvitedTemplate(props);
    const text = extractText(element);
    expect(text).toContain('Accept Invitation');
  });

  test('contains Decline option', () => {
    const props = { ...baseProps, invitationAcceptUrl: 'http://localhost:3000/invite/abc123' };
    const element = MemberInvitedTemplate(props);
    const text = extractText(element);
    expect(text).toContain('Decline');
  });
});

// ============================================================================
// 8. TaskCompletedTemplate Tests
// ============================================================================

describe('TaskCompletedTemplate', () => {
  test('renders without errors', () => {
    const element = TaskCompletedTemplate(baseProps);
    expect(element).toBeDefined();
  });

  test('contains completion indicator', () => {
    const element = TaskCompletedTemplate(baseProps);
    const text = extractText(element);
    expect(text).toContain('Completed');
    expect(text).toContain('✓');
  });

  test('contains task title', () => {
    const element = TaskCompletedTemplate(baseProps);
    const text = extractText(element);
    expect(text).toContain('Complete project proposal');
  });

  test('contains completion message', () => {
    const element = TaskCompletedTemplate(baseProps);
    const text = extractText(element);
    expect(text).toContain('has been marked complete');
  });

  test('contains actor name', () => {
    const element = TaskCompletedTemplate(baseProps);
    const text = extractText(element);
    expect(text).toContain('Jane Smith');
  });
});

// ============================================================================
// XSS Prevention Tests
// ============================================================================

describe('XSS Prevention', () => {
  test('TaskAssignedTemplate sanitizes all user inputs', () => {
    const xssProps: TemplateProps = {
      recipientName: 'John<img src=x onerror="alert(1)">',
      organizationName: 'Acme<script>alert(2)</script>',
      taskTitle: 'Task<svg onload="alert(3)">',
      taskUrl: 'http://localhost:3000/test',
      actorName: 'Jane"><img onerror="alert(4)">',
    };
    const element = TaskAssignedTemplate(xssProps);
    const text = extractText(element);
    // Should not contain raw unescaped HTML tags
    expect(text).not.toContain('<script>');
    expect(text).not.toContain('<img');
    expect(text).not.toContain('<svg');
  });

  test('CommentAddedTemplate sanitizes comment text', () => {
    const props = {
      ...baseProps,
      commentText: '<script>alert("xss")</script><img src=x onerror="alert()">',
    };
    const element = CommentAddedTemplate(props);
    const text = extractText(element);
    // Should not contain raw unescaped HTML tags
    expect(text).not.toContain('<script>');
    expect(text).not.toContain('<img');
  });

  test('ProjectCreatedTemplate sanitizes project name with special chars', () => {
    const props = {
      ...baseProps,
      projectName: 'Project"><svg onload="alert()"><img src=x onerror="alert()">',
    };
    const element = ProjectCreatedTemplate(props);
    const text = extractText(element);
    // Should not contain raw unescaped HTML tags
    expect(text).not.toContain('<svg');
    expect(text).not.toContain('<img');
  });

  test('StatusChangedTemplate handles status without XSS', () => {
    const props = {
      ...baseProps,
      statusBefore: 'backlog<img src=x>',
      statusAfter: 'done<script>',
    };
    const element = StatusChangedTemplate(props);
    const text = extractText(element);
    // Sanitized content should not have raw HTML tags
    expect(text).not.toContain('<script>');
    expect(text).not.toContain('<img');
  });

  test('sanitizeForEmail properly escapes dangerous characters', () => {
    const testCases = [
      { input: '<script>alert(1)</script>', shouldNotContain: '<script>' },
      { input: 'onclick="alert()"', shouldNotContain: '"' }, // Quotes get escaped
      { input: 'test&more', shouldContain: '&amp;' }, // Ampersand gets escaped
      { input: '"quoted"', shouldContain: '&quot;' }, // Quotes get escaped to &quot;
    ];

    testCases.forEach(({ input, shouldNotContain, shouldContain }) => {
      const sanitized = sanitizeForEmail(input);
      if (shouldNotContain) {
        expect(sanitized).not.toContain(shouldNotContain);
      }
      if (shouldContain) {
        expect(sanitized).toContain(shouldContain);
      }
    });
  });
});

// ============================================================================
// Edge Cases and Special Scenarios
// ============================================================================

describe('Edge Cases', () => {
  test('handles undefined actor name', () => {
    const props = { ...baseProps, actorName: undefined };
    const element = TaskAssignedTemplate(props);
    const text = extractText(element);
    expect(text).toMatch(/Jane Smith|A team member|assigned/);
  });

  test('handles empty strings', () => {
    const props = {
      recipientName: '',
      organizationName: '',
      taskTitle: '',
      taskUrl: '',
    };
    const element = TaskAssignedTemplate(props);
    expect(element).toBeDefined();
  });

  test('handles very long strings', () => {
    const longString = 'a'.repeat(1000);
    const props = { ...baseProps, taskTitle: longString };
    const element = TaskAssignedTemplate(props);
    const text = extractText(element);
    expect(text.length).toBeGreaterThan(0);
  });

  test('handles special characters in organization name', () => {
    const props = {
      ...baseProps,
      organizationName: 'Acme & Co. "Premium" Edition™ © 2026',
    };
    const element = TaskAssignedTemplate(props);
    const text = extractText(element);
    expect(text).toContain('Acme');
  });

  test('handles various date formats', () => {
    const dateVariations = [
      '2026-01-15',
      '2026-12-31',
      '2026-06-15T10:00:00Z',
    ];

    dateVariations.forEach((date) => {
      const props = { ...baseProps, dueDate: date };
      const element = DueSoonTemplate(props);
      const text = extractText(element);
      expect(text).toContain('is due');
    });
  });

  test('handles null/undefined optional props gracefully', () => {
    const props: TemplateProps = {
      recipientName: 'John',
      organizationName: 'Acme',
      taskTitle: 'Task',
      taskUrl: 'http://localhost:3000/test',
      actorName: undefined,
      dueDate: undefined,
      commentText: undefined,
      projectName: undefined,
    };

    const templates = [
      TaskAssignedTemplate(props),
      TaskMentionedTemplate(props),
      StatusChangedTemplate(props),
      DueSoonTemplate(props),
      CommentAddedTemplate(props),
      ProjectCreatedTemplate(props),
      MemberInvitedTemplate(props),
      TaskCompletedTemplate(props),
    ];

    templates.forEach((element) => {
      expect(element).toBeDefined();
      expect(element.type).toBeDefined();
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  test('all 8 templates can be created', () => {
    const templates = [
      TaskAssignedTemplate(baseProps),
      TaskMentionedTemplate(baseProps),
      StatusChangedTemplate({ ...baseProps, statusBefore: 'backlog', statusAfter: 'done' }),
      DueSoonTemplate({ ...baseProps, dueDate: '2026-01-15' }),
      CommentAddedTemplate({ ...baseProps, commentText: 'Test comment' }),
      ProjectCreatedTemplate({
        ...baseProps,
        projectName: 'Project',
        customData: { projectId: 'proj-123' },
      }),
      MemberInvitedTemplate({ ...baseProps, invitationAcceptUrl: 'http://localhost:3000/inv' }),
      TaskCompletedTemplate(baseProps),
    ];

    templates.forEach((element) => {
      expect(element).toBeDefined();
      expect(element.type).toBeDefined();
      expect(element.props).toBeDefined();
    });
  });

  test('all templates render with all required content', () => {
    const templates = [
      { element: TaskAssignedTemplate(baseProps), shouldContain: 'assigned' },
      { element: TaskMentionedTemplate(baseProps), shouldContain: 'mentioned' },
      { element: StatusChangedTemplate({ ...baseProps, statusBefore: 'backlog', statusAfter: 'done' }), shouldContain: 'changed' },
      { element: DueSoonTemplate({ ...baseProps, dueDate: '2026-01-15' }), shouldContain: 'Due' },
      { element: CommentAddedTemplate({ ...baseProps, commentText: 'Test' }), shouldContain: 'commented' },
      { element: ProjectCreatedTemplate({ ...baseProps, projectName: 'Project' }), shouldContain: 'Project' },
      { element: MemberInvitedTemplate({ ...baseProps, invitationAcceptUrl: 'http://localhost:3000/inv' }), shouldContain: 'invited' },
      { element: TaskCompletedTemplate(baseProps), shouldContain: 'Completed' },
    ];

    templates.forEach(({ element, shouldContain }) => {
      const text = extractText(element);
      expect(text).toContain(shouldContain);
      expect(text.length).toBeGreaterThan(0);
    });
  });

  test('task-based templates are consistent in structure', () => {
    const taskTemplates = [
      TaskAssignedTemplate(baseProps),
      TaskMentionedTemplate(baseProps),
      StatusChangedTemplate({ ...baseProps, statusBefore: 'backlog', statusAfter: 'done' }),
      DueSoonTemplate({ ...baseProps, dueDate: '2026-01-15' }),
      CommentAddedTemplate({ ...baseProps, commentText: 'Test' }),
      TaskCompletedTemplate(baseProps),
    ];

    taskTemplates.forEach((element) => {
      // All should be React elements
      expect(element).toBeDefined();
      expect(element.type).toBeDefined();
      // All should render with task information
      const text = extractText(element);
      expect(text).toContain('Complete project proposal');
    });
  });

  test('organization templates are independent', () => {
    const orgTemplates = [
      ProjectCreatedTemplate({
        ...baseProps,
        projectName: 'Project',
        customData: { projectId: 'proj-123' },
      }),
      MemberInvitedTemplate({ ...baseProps, invitationAcceptUrl: 'http://localhost:3000/inv' }),
    ];

    orgTemplates.forEach((element) => {
      expect(element).toBeDefined();
      const text = extractText(element);
      expect(text).toContain('Acme Corp');
    });
  });
});

// ============================================================================
// Component Structure Tests
// ============================================================================

describe('Component Structure', () => {
  test('all templates return React elements', () => {
    const allTemplates = [
      TaskAssignedTemplate(baseProps),
      TaskMentionedTemplate(baseProps),
      StatusChangedTemplate({ ...baseProps, statusBefore: 'backlog', statusAfter: 'done' }),
      DueSoonTemplate({ ...baseProps, dueDate: '2026-01-15' }),
      CommentAddedTemplate({ ...baseProps, commentText: 'Test' }),
      ProjectCreatedTemplate({ ...baseProps, projectName: 'Project' }),
      MemberInvitedTemplate({ ...baseProps, invitationAcceptUrl: 'http://localhost:3000/inv' }),
      TaskCompletedTemplate(baseProps),
    ];

    allTemplates.forEach((element) => {
      // React elements should have type and props
      expect(element).toHaveProperty('type');
      expect(element).toHaveProperty('props');
      expect(typeof element.type).toBe('function');
    });
  });

  test('templates accept all defined props', () => {
    const allProps: TemplateProps = {
      recipientName: 'John',
      organizationName: 'Acme',
      taskTitle: 'Task',
      taskUrl: 'http://localhost:3000/test',
      actorName: 'Jane',
      actorAvatarUrl: 'http://example.com/avatar.png',
      dueDate: '2026-01-15',
      statusBefore: 'backlog',
      statusAfter: 'done',
      commentText: 'Comment',
      projectName: 'Project',
      invitationAcceptUrl: 'http://localhost:3000/inv',
      customData: { projectId: 'proj-123' },
    };

    // All templates should accept these props without error
    const templates = [
      () => TaskAssignedTemplate(allProps),
      () => TaskMentionedTemplate(allProps),
      () => StatusChangedTemplate(allProps),
      () => DueSoonTemplate(allProps),
      () => CommentAddedTemplate(allProps),
      () => ProjectCreatedTemplate(allProps),
      () => MemberInvitedTemplate(allProps),
      () => TaskCompletedTemplate(allProps),
    ];

    templates.forEach((creator) => {
      const element = creator();
      expect(element).toBeDefined();
    });
  });
});
