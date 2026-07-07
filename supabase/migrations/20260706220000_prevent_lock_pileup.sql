-- Incidente 2026-07-06: uma transação "idle in transaction (aborted)" segurou
-- o lock da linha de camply_workspace; os saves seguintes (FOR UPDATE via RPC)
-- empilharam esperando, o pool do PostgREST lotou e todo o /rest/v1 passou a
-- responder 504. Estas proteções tornam o cenário autocurável.

-- Transações paradas são encerradas automaticamente em vez de segurar locks
-- para sempre. Aplica-se a novas conexões dos papéis usados pelo PostgREST.
alter role authenticator set idle_in_transaction_session_timeout = '15s';
alter role authenticated  set idle_in_transaction_session_timeout = '15s';
alter role anon           set idle_in_transaction_session_timeout = '15s';

-- O RPC de salvamento falha rápido (erro 55P03, tratado como falha de save no
-- app) se a linha do workspace estiver travada, em vez de ocupar um slot do
-- pool esperando indefinidamente.
alter function public.save_camply_workspace_with_client_registry(jsonb, bigint)
  set lock_timeout = '5s';
