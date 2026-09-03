-- Adds Google Meet scheduling support to tasks: a single scheduled meeting
-- per task (mirrors the existing single due-date-sync event per task).
-- meet_event_id is the deterministic Calendar event ID used by
-- scheduleTaskMeeting() to make re-scheduling idempotent (update, not
-- duplicate).
alter table tasks
  add column meet_link text,
  add column meet_scheduled_at timestamptz,
  add column meet_event_id text;
