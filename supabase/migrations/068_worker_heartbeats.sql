-- Worker heartbeat table for independent worker health reporting
CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name TEXT NOT NULL UNIQUE,
  pid INT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS worker_heartbeats_last_seen_idx ON public.worker_heartbeats (last_heartbeat_at);
