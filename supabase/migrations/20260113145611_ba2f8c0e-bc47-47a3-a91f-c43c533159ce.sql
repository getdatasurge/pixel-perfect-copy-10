-- Create emulator_locks table to track active emulator sessions
CREATE TABLE public.emulator_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE,  -- One lock per org
  user_id UUID NOT NULL,
  session_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_info TEXT
);

-- Enable RLS
ALTER TABLE public.emulator_locks ENABLE ROW LEVEL SECURITY;

-- Allow service role operations
CREATE POLICY "Allow webhook select on emulator_locks" ON public.emulator_locks FOR SELECT USING (true);
CREATE POLICY "Allow webhook insert on emulator_locks" ON public.emulator_locks FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow webhook update on emulator_locks" ON public.emulator_locks FOR UPDATE USING (true);
CREATE POLICY "Allow webhook delete on emulator_locks" ON public.emulator_locks FOR DELETE USING (true);