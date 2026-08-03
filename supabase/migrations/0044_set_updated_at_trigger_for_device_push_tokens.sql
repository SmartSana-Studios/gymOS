-- Migration 0044: trigger to keep updated_at current on device_push_tokens
-- Adds a simple BEFORE UPDATE trigger to maintain updated_at = now()

CREATE OR REPLACE FUNCTION public.set_updated_at_timestamptz()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Create trigger (no IF NOT EXISTS in CREATE TRIGGER; harmless if run once)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_device_push_tokens_set_updated_at'
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_device_push_tokens_set_updated_at
      BEFORE UPDATE ON public.device_push_tokens
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at_timestamptz()';
  END IF;
END;
$$;
