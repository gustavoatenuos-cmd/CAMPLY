-- Fixture para testar migração local 0002 -> 0003
-- Contém:
-- UUIDs fictícios;
-- campanhas fictícias;
-- métricas duplicadas;
-- campos null;
-- attribution_setting null;
-- adset_id null;
-- timezone null;
-- datas null quando permitidas no schema anterior.

-- Remove run anterior (se houver) para evitar conflitos na mesma base local
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001';

-- Insere User Mock
INSERT INTO auth.users (id, instance_id, role, aud, email, encrypted_password, email_confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test@camply.com', '', now(), now(), '{}', '{}', now(), now(), '', '', '', '');

-- Insere Sync Run
INSERT INTO meta_sync_runs (id, user_id, ad_account_id, graph_api_version, requested_period, status)
VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'act_12345', 'v20.0', 'today', 'success');

-- Insere Snapshot Raw
INSERT INTO meta_raw_snapshots (id, user_id, sync_run_id, ad_account_id, entity_level, entity_id, endpoint, payload)
VALUES ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'act_12345', 'campaign', 'camp_001', 'insights', '{"spend": "100.0"}');

-- Insere Entities
INSERT INTO meta_campaign_entities (id, user_id, client_id, ad_account_id, campaign_id, campaign_name, raw_objective, classified_objective)
VALUES ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'client_abc', 'act_12345', 'camp_001', 'Campanha Ficticia 1', 'OUTCOME_LEADS', 'LEADS');

-- Insere Normalized Metrics: Duplicadas e com nulls conforme esperado
-- Métrica sem adset, timezone, attribution (nível campanha limpo)
INSERT INTO meta_normalized_metrics (id, user_id, sync_run_id, ad_account_id, campaign_id, adset_id, metric_id, metric_value, action_type, source_field, date_start, date_stop, timezone, attribution_setting)
VALUES 
-- Duplicata Exata
('44444444-4444-4444-4444-444444444441', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'act_12345', 'camp_001', null, 'spend', 100.0, null, 'global', '2026-06-27', '2026-06-27', null, null),
('44444444-4444-4444-4444-444444444442', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'act_12345', 'camp_001', null, 'spend', 100.0, null, 'global', '2026-06-27', '2026-06-27', null, null),

-- Métrica no adset
('44444444-4444-4444-4444-444444444443', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'act_12345', 'camp_001', 'adset_001', 'results', 15.0, 'lead', 'action_values', '2026-06-27', '2026-06-27', 'America/Sao_Paulo', '7d_click'),

-- Métrica com datas nulas (se for possível pelo schema antigo)
('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'act_12345', 'camp_001', null, 'reach', 5000, null, 'global', null, null, null, null);
