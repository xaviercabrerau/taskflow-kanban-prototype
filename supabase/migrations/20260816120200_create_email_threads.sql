-- Create email_threads table for tracking Gmail message threads
CREATE TABLE email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id TEXT UNIQUE NOT NULL,
  gmail_thread_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for efficient message_id lookups
CREATE INDEX idx_email_threads_message_id
  ON email_threads(message_id);
