-- Migration 0043: index to support cleanup by expo_push_token
-- Adds a btree index on expo_push_token to avoid sequential scans during deletes

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_expo_push_token
  ON public.device_push_tokens(expo_push_token);
