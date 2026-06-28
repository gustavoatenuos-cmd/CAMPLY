-- Migration: OAuth Security and Token Versioning
-- Description: Adds atomic consumption of OAuth state and key versioning for tokens.

-- Add token version tracking to integrations
ALTER TABLE meta_integrations 
ADD COLUMN token_key_version INTEGER NOT NULL DEFAULT 1;

-- Function to atomically consume an OAuth state
CREATE OR REPLACE FUNCTION consume_meta_oauth_state(p_state_hash TEXT)
RETURNS TABLE (
    user_id UUID,
    redirect_uri TEXT,
    scopes TEXT[]
) AS $$
DECLARE
    v_state_record RECORD;
BEGIN
    -- Select for update to lock the row
    SELECT * INTO v_state_record
    FROM meta_oauth_states
    WHERE state_hash = p_state_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'STATE_NOT_FOUND';
    END IF;

    IF v_state_record.used_at IS NOT NULL THEN
        RAISE EXCEPTION 'STATE_ALREADY_USED';
    END IF;

    IF v_state_record.expires_at < now() THEN
        RAISE EXCEPTION 'STATE_EXPIRED';
    END IF;

    -- Mark as used
    UPDATE meta_oauth_states
    SET used_at = now()
    WHERE state_hash = p_state_hash;

    RETURN QUERY SELECT v_state_record.user_id, v_state_record.redirect_uri, v_state_record.scopes;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
