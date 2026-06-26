-- Migration: Workspace RLS
-- Description: Protects the camply_workspace table with Row Level Security.

-- 1. Create table if it doesn't exist (just in case it was created via UI only)
CREATE TABLE IF NOT EXISTS public.camply_workspace (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE public.camply_workspace ENABLE ROW LEVEL SECURITY;

-- 3. Create Policy
-- A user can only manage their own workspace where id = auth.uid()
CREATE POLICY "Users can manage their own workspace"
ON public.camply_workspace
FOR ALL
TO authenticated
USING (id = auth.uid()::text)
WITH CHECK (id = auth.uid()::text);
