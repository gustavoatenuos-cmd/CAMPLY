-- The frontend has exclusively called try_save_camply_workspace_with_client_registry
-- since 2026-07-08 (commit a84bbd0, "fix: guard workspace version conflicts"), which
-- returns a {status: 'conflict', current_version} payload instead of raising on a
-- version mismatch. The two older RPCs below still RAISE EXCEPTION 'Workspace changed
-- in another session. Reload before saving.' (SQLSTATE 40001) on the same conflict,
-- and something still calling them directly (a stale cached browser session running
-- pre-2026-07-08 JS, confirmed live via pg_stat_activity) has been hitting that
-- exception in a retry loop for days, flooding the Postgres logs and at least once
-- leaving a connection stuck in "idle in transaction (aborted)".
--
-- Nothing in the current codebase calls these two functions anymore, so revoking
-- execute access does not change any working behavior - it only turns an already
-- 100%-failing call (loud SQL exception) into a clean permission-denied response,
-- which stops the log flood and nudges any remaining stale client to reload.

revoke execute on function public.save_camply_workspace(jsonb, bigint) from authenticated;
revoke execute on function public.save_camply_workspace_with_client_registry(jsonb, bigint) from authenticated;
