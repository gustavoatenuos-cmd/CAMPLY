const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const RESULT_FILE = '/tmp/camply-rls-result.json';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function run() {
  console.log('--- TEST: RLS A vs B ---');
  fs.rmSync(RESULT_FILE, { force: true });

  const localStatus = JSON.parse(execSync('npx supabase status --output json').toString());
  const apiUrl = localStatus.API_URL;
  const anonKey = localStatus.ANON_KEY;

  async function signUp(label) {
    const response = await fetch(`${apiUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({
        email: `${label}_${Date.now()}_${crypto.randomUUID()}@camply.test`,
        password: 'password123',
      }),
    });
    const body = await response.json();
    assertEqual(response.status, 200, `${label} signup should succeed`);
    assert(body.access_token && body.user?.id, `${label} signup should return a session`);
    return { token: body.access_token, userId: body.user.id };
  }

  const userA = await signUp('rls_a');
  const userB = await signUp('rls_b');
  const integrationA = crypto.randomUUID();
  const assetA = crypto.randomUUID();
  const runA = crypto.randomUUID();
  const adAccountA = `act_${crypto.randomUUID().slice(0, 8)}`;

  execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
    INSERT INTO meta_integrations (id, user_id, access_token_encrypted, status)
    VALUES ('${integrationA}', '${userA.userId}', 'local-test-token', 'active');

    INSERT INTO meta_assets (id, integration_id, asset_type, asset_id, asset_name)
    VALUES ('${assetA}', '${integrationA}', 'adaccount', '${adAccountA}', 'RLS Test Account');

    INSERT INTO meta_sync_runs (id, user_id, integration_id, ad_account_id, graph_api_version, requested_period, status)
    VALUES ('${runA}', '${userA.userId}', '${integrationA}', '${adAccountA}', 'v25.0', 'last_7d', 'success');

    INSERT INTO meta_campaign_snapshots
      (user_id, integration_id, ad_account_id, sync_run_id, campaign_id, campaign_name, meta_status, effective_status)
    VALUES
      ('${userA.userId}', '${integrationA}', '${adAccountA}', '${runA}', 'camp_rls', 'RLS Campaign', 'ACTIVE', 'ACTIVE');

    INSERT INTO meta_adset_snapshots
      (user_id, integration_id, ad_account_id, sync_run_id, campaign_id, adset_id, adset_name, meta_status, effective_status)
    VALUES
      ('${userA.userId}', '${integrationA}', '${adAccountA}', '${runA}', 'camp_rls', 'adset_rls', 'RLS Adset', 'ACTIVE', 'ACTIVE');

    INSERT INTO meta_raw_snapshots
      (user_id, integration_id, sync_run_id, ad_account_id, entity_level, entity_id, endpoint, payload)
    VALUES
      ('${userA.userId}', '${integrationA}', '${runA}', '${adAccountA}', 'campaign', 'camp_rls', '/insights', '{}');

    INSERT INTO meta_normalized_metrics
      (user_id, integration_id, sync_run_id, ad_account_id, campaign_id, metric_id, metric_value, source_level, completeness_status)
    VALUES
      ('${userA.userId}', '${integrationA}', '${runA}', '${adAccountA}', 'camp_rls', 'spend', 10, 'campaign', 'complete');
  "`);

  const restUrl = `${apiUrl}/rest/v1`;

  async function request(path, token, options = {}) {
    const response = await fetch(`${restUrl}/${path}`, {
      ...options,
      headers: {
        apikey: anonKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { response, body };
  }

  const resources = [
    'meta_sync_runs',
    'meta_campaign_snapshots',
    'meta_adset_snapshots',
    'meta_raw_snapshots',
    'meta_normalized_metrics',
  ];

  for (const resource of resources) {
    const own = await request(`${resource}?select=id`, userA.token);
    assertEqual(own.response.status, 200, `User A should query ${resource}`);
    assert(Array.isArray(own.body) && own.body.length === 1, `User A should see one row in ${resource}`);

    const foreign = await request(`${resource}?select=id`, userB.token);
    assertEqual(foreign.response.status, 200, `User B query should be RLS-filtered for ${resource}`);
    assert(Array.isArray(foreign.body) && foreign.body.length === 0, `User B should see zero rows in ${resource}`);

    const anonymous = await request(`${resource}?select=id`, null);
    assert([401, 403].includes(anonymous.response.status), `Anonymous should be denied for ${resource}`);
    assertEqual(anonymous.body?.code, '42501', `Anonymous denial code for ${resource}`);
  }

  const foreignAssetResponse = await fetch(`${apiUrl}/functions/v1/meta-sync-ads`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${userB.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ metaAssetId: assetA, periods: ['last_7d'] }),
  });
  assertEqual(foreignAssetResponse.status, 403, 'User B must not use User A asset');

  const insertAttempt = await request('meta_sync_runs', userB.token, {
    method: 'POST',
    body: JSON.stringify({
      user_id: userB.userId,
      integration_id: integrationA,
      ad_account_id: adAccountA,
      graph_api_version: 'v25.0',
      requested_period: 'last_7d',
      status: 'running',
    }),
  });
  assert([401, 403].includes(insertAttempt.response.status), 'Authenticated users must not insert sync runs directly');
  assertEqual(insertAttempt.body?.code, '42501', 'Insert denial code');

  const updateAttempt = await request(`meta_sync_runs?id=eq.${runA}`, userB.token, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'failed' }),
  });
  assert([401, 403].includes(updateAttempt.response.status), 'Authenticated users must not update sync runs directly');
  assertEqual(updateAttempt.body?.code, '42501', 'Update denial code');

  const privilegeOutput = execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -q -U postgres -d postgres -t -A -F ',' -c "
    SELECT
      has_function_privilege('anon', p.oid, 'EXECUTE'),
      has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      has_function_privilege('service_role', p.oid, 'EXECUTE')
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'persist_meta_sync_run';
  "`).toString().trim();
  assertEqual(privilegeOutput, 'f,f,t', 'RPC privileges must be anon=false, authenticated=false, service_role=true');

  for (const token of [null, userA.token]) {
    const rpcAttempt = await request('rpc/persist_meta_sync_run', token, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assertEqual(rpcAttempt.response.status, 404, 'Restricted RPC should be hidden by PostgREST');
    assertEqual(rpcAttempt.body?.code, 'PGRST202', 'Restricted RPC should return PGRST202');
  }

  const result = {
    resources_checked: resources.length,
    foreign_asset_status: foreignAssetResponse.status,
    insert_status: insertAttempt.response.status,
    update_status: updateAttempt.response.status,
    rpc_privileges: privilegeOutput,
  };
  fs.writeFileSync(RESULT_FILE, JSON.stringify(result));
  console.log('✅ RLS and API Security validated');
}

run().catch((error) => {
  fs.rmSync(RESULT_FILE, { force: true });
  console.error('RLS API test failed:', error.message);
  process.exit(1);
});
