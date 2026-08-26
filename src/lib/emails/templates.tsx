/**
 * Email Template Components
 * Task 6: Email templates for all 8 notification event types
 * Uses TaskNotificationLayout and utilities from Task 5
 */

import React from 'react';
import { Button, Section, Text, Link } from 'react-email';
import { TaskNotificationLayout, BaseLayout } from './layouts';
import { formatDate, sanitizeForEmail } from './utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * TemplateProps
 * Common props interface for all email template components.
 */
export interface TemplateProps {
  /** Name of the person receiving the email */
  recipientName: string;

  /** Name of the organization */
  organizationName: string;

  /** Title of the task */
  taskTitle: string;

  /** URL to view the task */
  taskUrl: string;

  /** Name of the person who triggered the event */
  actorName?: string;

  /** Avatar URL of the actor */
  actorAvatarUrl?: string;

  /** Due date in ISO format */
  dueDate?: string;

  /** Previous status (for status_changed) */
  statusBefore?: string;

  /** New status (for status_changed) */
  statusAfter?: string;

  /** Comment text (for comment_added) */
  commentText?: string;

  /** Project name (for project_created) */
  projectName?: string;

  /** URL to accept invitation (for member_invited) */
  invitationAcceptUrl?: string;

  /** Custom data object (for additional props) */
  customData?: Record<string, unknown>;
}

// ============================================================================
// Color and Style Definitions
// ============================================================================

const colors = {
  primary: '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  gray: '#6B7280',
};

const statusColors: Record<string, string> = {
  backlog: '#6b7280',
  in_progress: '#3b82f6',
  review: '#a855f7',
  done: '#10b981',
};

// ============================================================================
// 1. TaskAssignedTemplate
// ============================================================================

/**
 * TaskAssignedTemplate
 * Email sent when a user is assigned to a task.
 * Event: task_assigned
 */
export const TaskAssignedTemplate = (props: TemplateProps) => (
  <TaskNotificationLayout
    subject={`${sanitizeForEmail(props.actorName || 'Someone')} assigned you to this task`}
    taskTitle={props.taskTitle}
    taskUrl={props.taskUrl}
  >
    <Section
      style={{
        marginBottom: '20px',
      }}
    >
      <Text
        style={{
          margin: '0 0 16px 0',
          fontSize: '16px',
          color: '#374151',
          lineHeight: '1.6',
        }}
      >
        {sanitizeForEmail(props.actorName || 'A team member')} assigned you to{' '}
        <strong>&ldquo;{sanitizeForEmail(props.taskTitle)}&rdquo;</strong> in{' '}
        {sanitizeForEmail(props.organizationName)}.
      </Text>

      <Text
        style={{
          margin: '0',
          fontSize: '14px',
          color: '#6b7280',
          lineHeight: '1.5',
        }}
      >
        You can view the full task details and collaborate with your team by clicking the button
        below.
      </Text>
    </Section>
  </TaskNotificationLayout>
);

// ============================================================================
// 2. TaskMentionedTemplate
// ============================================================================

/**
 * TaskMentionedTemplate
 * Email sent when a user is mentioned in a task.
 * Event: task_mentioned
 */
export const TaskMentionedTemplate = (props: TemplateProps) => (
  <TaskNotificationLayout
    subject={`You were mentioned in: ${sanitizeForEmail(props.taskTitle)}`}
    taskTitle={props.taskTitle}
    taskUrl={props.taskUrl}
  >
    <Section
      style={{
        marginBottom: '20px',
      }}
    >
      <Text
        style={{
          margin: '0 0 16px 0',
          fontSize: '16px',
          color: '#374151',
          lineHeight: '1.6',
        }}
      >
        {sanitizeForEmail(props.actorName || 'A team member')} mentioned you in{' '}
        <strong>&ldquo;{sanitizeForEmail(props.taskTitle)}&rdquo;</strong>.
      </Text>

      <Text
        style={{
          margin: '0',
          fontSize: '14px',
          color: '#6b7280',
          lineHeight: '1.5',
        }}
      >
        Check the task to see the mention and reply to the conversation.
      </Text>
    </Section>
  </TaskNotificationLayout>
);

// ============================================================================
// 3. StatusChangedTemplate
// ============================================================================

/**
 * StatusChangedTemplate
 * Email sent when a task status changes.
 * Event: status_changed
 */
export const StatusChangedTemplate = (props: TemplateProps) => {
  const statusAfter = props.statusAfter || 'unknown';
  const statusBefore = props.statusBefore || 'unknown';
  const statusColor = statusColors[statusAfter] || colors.gray;

  return (
    <TaskNotificationLayout
      subject={`${sanitizeForEmail(props.taskTitle)} status changed to ${statusAfter}`}
      taskTitle={props.taskTitle}
      taskUrl={props.taskUrl}
    >
      <Section
        style={{
          marginBottom: '20px',
        }}
      >
        <Text
          style={{
            margin: '0 0 20px 0',
            fontSize: '16px',
            color: '#374151',
            lineHeight: '1.6',
          }}
        >
          {sanitizeForEmail(props.actorName || 'A team member')} changed the status of{' '}
          <strong>&ldquo;{sanitizeForEmail(props.taskTitle)}&rdquo;</strong> from{' '}
          <strong>{sanitizeForEmail(statusBefore)}</strong> to{' '}
          <strong>{sanitizeForEmail(statusAfter)}</strong>.
        </Text>

        {/* Status Badge */}
        <Section
          style={{
            display: 'inline-block',
            backgroundColor: statusColor,
            color: '#ffffff',
            padding: '8px 16px',
            borderRadius: '6px',
            marginBottom: '20px',
            textAlign: 'center',
            width: '100%',
          }}
        >
          <Text
            style={{
              margin: '0',
              fontSize: '14px',
              fontWeight: '600',
              color: '#ffffff',
              textTransform: 'capitalize',
            }}
          >
            ✓ {sanitizeForEmail(statusAfter)}
          </Text>
        </Section>

        <Text
          style={{
            margin: '0',
            fontSize: '14px',
            color: '#6b7280',
            lineHeight: '1.5',
          }}
        >
          View the task to see more details and add your updates.
        </Text>
      </Section>
    </TaskNotificationLayout>
  );
};

// ============================================================================
// 4. DueSoonTemplate
// ============================================================================

/**
 * DueSoonTemplate
 * Email sent as a reminder for upcoming task deadlines.
 * Event: due_soon
 */
export const DueSoonTemplate = (props: TemplateProps) => {
  const formattedDate = props.dueDate ? formatDate(props.dueDate, 'long') : 'soon';

  return (
    <TaskNotificationLayout
      subject={`Reminder: ${sanitizeForEmail(props.taskTitle)} is due ${formattedDate}`}
      taskTitle={props.taskTitle}
      taskUrl={props.taskUrl}
    >
      <Section
        style={{
          marginBottom: '20px',
        }}
      >
        {/* Urgency Indicator */}
        <Section
          style={{
            backgroundColor: '#FEF3C7',
            borderLeft: `4px solid ${colors.warning}`,
            padding: '12px 16px',
            marginBottom: '20px',
            borderRadius: '4px',
          }}
        >
          <Text
            style={{
              margin: '0',
              fontSize: '14px',
              fontWeight: '600',
              color: '#92400e',
            }}
          >
            ⏰ Due Soon
          </Text>
        </Section>

        <Text
          style={{
            margin: '0 0 16px 0',
            fontSize: '16px',
            color: '#374151',
            lineHeight: '1.6',
          }}
        >
          <strong>&ldquo;{sanitizeForEmail(props.taskTitle)}&rdquo;</strong> is due on{' '}
          <strong>{formattedDate}</strong>.
        </Text>

        <Text
          style={{
            margin: '0',
            fontSize: '14px',
            color: '#6b7280',
            lineHeight: '1.5',
          }}
        >
          Make sure to complete this task before the deadline. Click below to update the task
          status.
        </Text>
      </Section>
    </TaskNotificationLayout>
  );
};

// ============================================================================
// 5. CommentAddedTemplate
// ============================================================================

/**
 * CommentAddedTemplate
 * Email sent when a new comment is added to a task.
 * Event: comment_added
 */
export const CommentAddedTemplate = (props: TemplateProps) => {
  const truncatedComment = props.commentText
    ? props.commentText.length > 200
      ? `${props.commentText.substring(0, 200)}...`
      : props.commentText
    : '(empty comment)';

  const sanitizedComment = sanitizeForEmail(truncatedComment);

  return (
    <TaskNotificationLayout
      subject={`New comment on: ${sanitizeForEmail(props.taskTitle)}`}
      taskTitle={props.taskTitle}
      taskUrl={props.taskUrl}
    >
      <Section
        style={{
          marginBottom: '20px',
        }}
      >
        <Text
          style={{
            margin: '0 0 16px 0',
            fontSize: '16px',
            color: '#374151',
            lineHeight: '1.6',
          }}
        >
          {sanitizeForEmail(props.actorName || 'A team member')} commented on{' '}
          <strong>&ldquo;{sanitizeForEmail(props.taskTitle)}&rdquo;</strong>:
        </Text>

        {/* Comment Preview */}
        <Section
          style={{
            backgroundColor: '#f9fafb',
            borderLeft: `4px solid ${colors.primary}`,
            padding: '16px',
            marginBottom: '20px',
            borderRadius: '4px',
          }}
        >
          <Text
            style={{
              margin: '0',
              fontSize: '14px',
              color: '#374151',
              lineHeight: '1.5',
              fontStyle: 'italic',
            }}
          >
            &ldquo;{sanitizedComment}&rdquo;
          </Text>
        </Section>

        <Text
          style={{
            margin: '0',
            fontSize: '14px',
            color: '#6b7280',
            lineHeight: '1.5',
          }}
        >
          View the task to read the full comment and reply.
        </Text>
      </Section>
    </TaskNotificationLayout>
  );
};

// ============================================================================
// 6. ProjectCreatedTemplate
// ============================================================================

/**
 * ProjectCreatedTemplate
 * Email sent when a new project is created.
 * Event: project_created
 */
export const ProjectCreatedTemplate = (props: TemplateProps) => {
  const projectId = (props.customData?.projectId as string | undefined) || '';
  const projectUrl = projectId
    ? `${props.taskUrl.split('/tasks/')[0]}/projects/${projectId}`
    : '#';

  return (
    <BaseLayout recipientName={props.recipientName} organizationName={props.organizationName}>
      <Section
        style={{
          marginBottom: '20px',
        }}
      >
        <Text
          style={{
            margin: '0 0 12px 0',
            fontSize: '18px',
            fontWeight: '700',
            color: '#1f2937',
          }}
        >
          New Project Created
        </Text>

        <Text
          style={{
            margin: '0 0 16px 0',
            fontSize: '16px',
            color: '#374151',
            lineHeight: '1.6',
          }}
        >
          {sanitizeForEmail(props.actorName || 'A team member')} created a new project{' '}
          <strong>&ldquo;{sanitizeForEmail(props.projectName || 'Project')}&rdquo;</strong> in{' '}
          {sanitizeForEmail(props.organizationName)}.
        </Text>

        <Text
          style={{
            margin: '0 0 20px 0',
            fontSize: '14px',
            color: '#6b7280',
            lineHeight: '1.5',
          }}
        >
          You&apos;ve been added as a member. Start collaborating with your team on this new project.
        </Text>

        {/* Action Button */}
        <Section
          style={{
            marginTop: '20px',
            marginBottom: '0',
            textAlign: 'center',
          }}
        >
          <Button
            href={projectUrl}
            style={{
              backgroundColor: colors.primary,
              color: '#ffffff',
              padding: '12px 30px',
              borderRadius: '6px',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: '600',
              display: 'inline-block',
              border: `1px solid ${colors.primary}`,
            }}
          >
            View Project
          </Button>
        </Section>
      </Section>
    </BaseLayout>
  );
};

// ============================================================================
// 7. MemberInvitedTemplate
// ============================================================================

/**
 * MemberInvitedTemplate
 * Email sent when a user is invited to join an organization.
 * Event: member_invited
 */
export const MemberInvitedTemplate = (props: TemplateProps) => (
  <BaseLayout recipientName={props.recipientName} organizationName={props.organizationName}>
    <Section
      style={{
        marginBottom: '20px',
      }}
    >
      <Text
        style={{
          margin: '0 0 12px 0',
          fontSize: '18px',
          fontWeight: '700',
          color: '#1f2937',
        }}
      >
        You&apos;re Invited
      </Text>

      <Text
        style={{
          margin: '0 0 16px 0',
          fontSize: '16px',
          color: '#374151',
          lineHeight: '1.6',
        }}
      >
        {sanitizeForEmail(props.actorName || 'A team member')} invited you to join{' '}
        <strong>{sanitizeForEmail(props.organizationName)}</strong> on TaskFlow.
      </Text>

      <Text
        style={{
          margin: '0 0 20px 0',
          fontSize: '14px',
          color: '#6b7280',
          lineHeight: '1.5',
        }}
      >
        Join the organization to start collaborating with your team, manage tasks, and organize
        projects.
      </Text>

      {/* Action Buttons */}
      <Section
        style={{
          marginTop: '30px',
          marginBottom: '20px',
          textAlign: 'center',
        }}
      >
        <Button
          href={props.invitationAcceptUrl || '#'}
          style={{
            backgroundColor: colors.success,
            color: '#ffffff',
            padding: '12px 30px',
            borderRadius: '6px',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: '600',
            display: 'inline-block',
            border: `1px solid ${colors.success}`,
            marginRight: '10px',
          }}
        >
          Accept Invitation
        </Button>
      </Section>

      <Section
        style={{
          textAlign: 'center',
        }}
      >
        <Text
          style={{
            margin: '0',
            fontSize: '14px',
            color: '#6b7280',
          }}
        >
          <Link
            href="#"
            style={{
              color: colors.primary,
              textDecoration: 'underline',
            }}
          >
            Decline this invitation
          </Link>
        </Text>
      </Section>
    </Section>
  </BaseLayout>
);

// ============================================================================
// 8. TaskCompletedTemplate
// ============================================================================

/**
 * TaskCompletedTemplate
 * Email sent when a task is marked as complete.
 * Event: task_completed
 */
export const TaskCompletedTemplate = (props: TemplateProps) => (
  <TaskNotificationLayout
    subject={`✓ Task complete: ${sanitizeForEmail(props.taskTitle)}`}
    taskTitle={props.taskTitle}
    taskUrl={props.taskUrl}
  >
    <Section
      style={{
        marginBottom: '20px',
      }}
    >
      {/* Completion Badge */}
      <Section
        style={{
          backgroundColor: colors.success,
          color: '#ffffff',
          padding: '12px 16px',
          marginBottom: '20px',
          borderRadius: '6px',
          textAlign: 'center',
        }}
      >
        <Text
          style={{
            margin: '0',
            fontSize: '14px',
            fontWeight: '600',
            color: '#ffffff',
          }}
        >
          ✓ Completed
        </Text>
      </Section>

      <Text
        style={{
          margin: '0 0 16px 0',
          fontSize: '16px',
          color: '#374151',
          lineHeight: '1.6',
        }}
      >
        <strong>&ldquo;{sanitizeForEmail(props.taskTitle)}&rdquo;</strong> has been marked
        complete!
      </Text>

      <Text
        style={{
          margin: '0 0 12px 0',
          fontSize: '14px',
          color: '#6b7280',
          lineHeight: '1.5',
        }}
      >
        Completed by: <strong>{sanitizeForEmail(props.actorName || 'A team member')}</strong>
      </Text>

      <Text
        style={{
          margin: '0',
          fontSize: '14px',
          color: '#6b7280',
          lineHeight: '1.5',
        }}
      >
        View the task to see completion details and celebrate the team&apos;s progress.
      </Text>
    </Section>
  </TaskNotificationLayout>
);
