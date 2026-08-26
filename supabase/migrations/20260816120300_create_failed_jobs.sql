-- Create failed_jobs table for tracking failed notification jobs
CREATE TABLE failed_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for efficient time-based queries
CREATE INDEX idx_failed_jobs_created
  ON failed_jobs(created_at DESC);
