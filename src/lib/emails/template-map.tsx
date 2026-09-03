/**
 * Maps each notification EventType to its React Email template component
 * and subject line, and renders both the HTML and plain-text versions.
 */

import { render } from 'react-email';
import type { EventType } from '../notifications/types';
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
} from './templates';
import { sanitizeForEmail } from './utils';

type TemplateComponent = (props: TemplateProps) => React.ReactElement;

export const SUBJECTS: Record<EventType, (props: TemplateProps) => string> = {
  task_assigned: (p) => `${sanitizeForEmail(p.actorName || 'Someone')} assigned you to this task`,
  task_mentioned: (p) => `You were mentioned in: ${sanitizeForEmail(p.taskTitle)}`,
  status_changed: (p) => `${sanitizeForEmail(p.taskTitle)} status changed to ${sanitizeForEmail(p.statusAfter || '')}`,
  due_soon: (p) => `Reminder: ${sanitizeForEmail(p.taskTitle)} is due soon`,
  comment_added: (p) => `New comment on: ${sanitizeForEmail(p.taskTitle)}`,
  project_created: (p) => `New project: ${sanitizeForEmail(p.projectName || p.taskTitle)}`,
  member_invited: (p) => `You're invited to join ${sanitizeForEmail(p.organizationName)} on TaskFlow`,
  task_completed: (p) => `✓ Task complete: ${sanitizeForEmail(p.taskTitle)}`,
};

const COMPONENTS: Record<EventType, TemplateComponent> = {
  task_assigned: TaskAssignedTemplate,
  task_mentioned: TaskMentionedTemplate,
  status_changed: StatusChangedTemplate,
  due_soon: DueSoonTemplate,
  comment_added: CommentAddedTemplate,
  project_created: ProjectCreatedTemplate,
  member_invited: MemberInvitedTemplate,
  task_completed: TaskCompletedTemplate,
};

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export async function getEmailContent(
  eventType: EventType,
  props: TemplateProps
): Promise<RenderedEmail> {
  const Component = COMPONENTS[eventType];
  const subject = SUBJECTS[eventType](props);
  const element = Component(props);

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { subject, html, text };
}
