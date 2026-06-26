-- Migration: Meta Ads Integration
-- Description: Creates tables, indexes, and RLS policies for a secure Meta integration.

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLES

-- Meta Integrations
CREATE TABLE IF NOT EXISTS public.meta_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL, -- Ties to auth.users (if using Supabase Auth) or custom logic
    workspace_id UUID, -- For future workspace isolation
    provider TEXT NOT NULL DEFAULT 'meta',
    meta_user_id TEXT,
    meta_user_name TEXT,
    access_token_encrypted TEXT NOT NULL,
    token_type TEXT DEFAULT 'bearer',
    token_expires_at TIMESTAMPTZ,
    granted_scopes TEXT[],
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'invalid')),
    last_validated_at TIMESTAMPTZ,
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Meta Assets (Ad Accounts, Pages)
CREATE TABLE IF NOT EXISTS public.meta_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integration_id UUID NOT NULL REFERENCES public.meta_integrations(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL CHECK (asset_type IN ('adaccount', 'page', 'business')),
    asset_id TEXT NOT NULL,
    asset_name TEXT NOT NULL,
    asset_status TEXT,
    currency TEXT,
    timezone_name TEXT,
    raw_json JSONB,
    is_selected BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(integration_id, asset_type, asset_id)
);

-- Meta Sync Logs (No sensitive data here)
CREATE TABLE IF NOT EXISTS public.meta_sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integration_id UUID NOT NULL REFERENCES public.meta_integrations(id) ON DELETE CASCADE,
    sync_type TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'error', 'partial')),
    status_code INT,
    error_code TEXT,
    message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Meta OAuth States (PKCE / State hash validation)
CREATE TABLE IF NOT EXISTS public.meta_oauth_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    workspace_id UUID,
    state_hash TEXT NOT NULL UNIQUE,
    redirect_uri TEXT NOT NULL,
    scopes TEXT[] NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. TRIGGERS for updated_at

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trg_meta_integrations_updated_at
BEFORE UPDATE ON public.meta_integrations
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER trg_meta_assets_updated_at
BEFORE UPDATE ON public.meta_assets
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 4. RLS & POLICIES

ALTER TABLE public.meta_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_oauth_states ENABLE ROW LEVEL SECURITY;

-- Note: In the MVP Camply version, you might not be using auth.uid().
-- Adjust these policies if you migrate to auth.uid() by replacing the using clause.
-- Here we'll use a standard auth.uid() check assuming Supabase Auth migration.
-- If no auth.uid() exists, these tables will be inaccessible to anon users on the frontend,
-- which is intended. They must be accessed via Edge Functions running as service_role.

-- For Edge Functions (Service Role): RLS is bypassed automatically.
-- For Frontend (authenticated user):
CREATE POLICY "Users can manage their own integrations"
ON public.meta_integrations
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can manage assets for their integrations"
ON public.meta_assets
FOR ALL
TO authenticated
USING (integration_id IN (SELECT id FROM public.meta_integrations WHERE user_id = auth.uid()))
WITH CHECK (integration_id IN (SELECT id FROM public.meta_integrations WHERE user_id = auth.uid()));

CREATE POLICY "Users can view sync logs for their integrations"
ON public.meta_sync_logs
FOR SELECT
TO authenticated
USING (integration_id IN (SELECT id FROM public.meta_integrations WHERE user_id = auth.uid()));

-- oauth_states are usually only created/read by the backend edge functions,
-- but just in case, we lock it to the user.
CREATE POLICY "Users can manage their oauth states"
ON public.meta_oauth_states
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 5. INDEXES for performance
CREATE INDEX idx_meta_integrations_user_id ON public.meta_integrations(user_id);
CREATE INDEX idx_meta_assets_integration_id ON public.meta_assets(integration_id);
CREATE INDEX idx_meta_sync_logs_integration_id ON public.meta_sync_logs(integration_id);
CREATE INDEX idx_meta_oauth_states_state_hash ON public.meta_oauth_states(state_hash);
