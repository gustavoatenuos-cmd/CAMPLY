const { execSync } = require('child_process');
const crypto = require('crypto');

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`❌ [FAIL] ${message}: Expected ${expected}, but got ${actual}`);
    process.exitCode = 1;
    throw new Error('Assertion failed');
  }
}

async function run() {
  console.log('--- TEST: RLS A vs B ---');
  
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const integrationA = crypto.randomUUID();
  const adAccountA = 'act_' + crypto.randomUUID().substring(0, 8);
  const runA = crypto.randomUUID();
  const emailA = `a_${Date.now()}@camply.test`;
  const emailB = `b_${Date.now()}@camply.test`;
  
  console.log('Setup: Inserting Users and Mock Data...');
  try {
    execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -q -U postgres -d postgres -c "
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${userA}', '${emailA}', '{}');
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${userB}', '${emailB}', '{}');
      
      INSERT INTO meta_integrations (id, user_id, access_token_encrypted, status) VALUES ('${integrationA}', '${userA}', 'tokenA', 'active');
      INSERT INTO meta_assets (id, integration_id, asset_type, asset_id, asset_name) 
      VALUES (gen_random_uuid(), '${integrationA}', 'adaccount', '${adAccountA}', 'Test Account');
      
      INSERT INTO meta_sync_runs (id, user_id, integration_id, ad_account_id, graph_api_version, requested_period, status) 
      VALUES ('${runA}', '${userA}', '${integrationA}', '${adAccountA}', 'v20.0', 'last_7d', 'success');
      
      INSERT INTO meta_campaign_snapshots (id, user_id, integration_id, ad_account_id, sync_run_id, campaign_id, campaign_name, meta_status, effective_status)
      VALUES (gen_random_uuid(), '${userA}', '${integrationA}', '${adAccountA}', '${runA}', 'camp_123', 'Campaign 123', 'ACTIVE', 'ACTIVE');
      
      INSERT INTO meta_adset_snapshots (id, user_id, integration_id, ad_account_id, sync_run_id, campaign_id, adset_id, adset_name, meta_status, effective_status)
      VALUES (gen_random_uuid(), '${userA}', '${integrationA}', '${adAccountA}', '${runA}', 'camp_123', 'adset_123', 'Adset 123', 'ACTIVE', 'ACTIVE');
      
      INSERT INTO meta_raw_snapshots (id, user_id, sync_run_id, integration_id, ad_account_id, entity_level, entity_id, endpoint, payload)
      VALUES (gen_random_uuid(), '${userA}', '${runA}', '${integrationA}', '${adAccountA}', 'campaign', 'camp_123', '/insights', '{}');
    "`);
  } catch (err) {
    console.error('Failed setup', err.message);
    process.exit(1);
  }

  function generateSupabaseToken(userId, role = 'authenticated') {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'supabase',
      sub: userId,
      aud: role,
      role: role,
      exp: Math.floor(Date.now() / 1000) + (60 * 60)
    })).toString('base64url');
    const secret = 'super-secret-jwt-token-with-at-least-32-characters-long';
    const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
  }

  const tokenA = generateSupabaseToken(userA);
  const tokenB = generateSupabaseToken(userB);
  const tokenAnon = generateSupabaseToken('anon', 'anon');
  const tokenServiceRole = generateSupabaseToken('service_role', 'service_role');

  const restUrl = 'http://127.0.0.1:54321/rest/v1';
  
  async function fetchResource(token, endpoint, method = 'GET', body = null) {
    const options = {
      method,
      headers: {
        'apikey': 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
        'Authorization': `Bearer ${token}`
      }
    };
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Prefer'] = 'return=representation';
      options.body = JSON.stringify(body);
    }
    const res = await fetch(`${restUrl}/${endpoint}`, options);
    let json;
    try { json = await res.json(); } catch(e) { json = null; }
    return { status: res.status, json };
  }

  // 1. Provar que a função existe
  const functionExists = execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -q -U postgres -d postgres -c "SELECT exists(select 1 from pg_proc where proname = 'persist_meta_sync_run');" -t`).toString().trim();
  assertEqual(functionExists, 't', 'persist_meta_sync_run function must exist in database');

  console.log('Testing User B reading A data...');
  const rawB = await fetchResource(tokenB, 'meta_raw_snapshots');
  assertEqual(rawB.status, 200, 'Read request should succeed but return empty');
  assertEqual(Array.isArray(rawB.json) && rawB.json.length, 0, 'User B should NOT see A raw snapshots');

  const adsetB = await fetchResource(tokenB, 'meta_adset_snapshots');
  assertEqual(adsetB.status, 200, 'Read request should succeed but return empty');
  assertEqual(Array.isArray(adsetB.json) && adsetB.json.length, 0, 'User B should NOT see A adset snapshots');

  const assetsB = await fetchResource(tokenB, 'meta_assets');
  assertEqual(assetsB.status, 200, 'Read request should succeed but return empty');
  assertEqual(Array.isArray(assetsB.json) && assetsB.json.length, 0, 'User B should NOT see A assets');

  console.log('Testing User B writes...');
  const runInsertB = await fetchResource(tokenB, 'meta_sync_runs', 'POST', {
    user_id: userA, // trying to insert as A
    integration_id: integrationA,
    ad_account_id: adAccountA,
    graph_api_version: 'v20.0',
    requested_period: 'last_7d',
    status: 'success'
  });
  // PostgREST typically returns 401/403 for RLS violations
  assertEqual(runInsertB.status === 403 || runInsertB.status === 401, true, 'User B should be 401/403 to insert as A');
  
  const runUpdateB = await fetchResource(tokenB, `meta_sync_runs?id=eq.${runA}`, 'PATCH', { status: 'failed' });
  assertEqual(runUpdateB.status === 403 || runUpdateB.status === 200 || runUpdateB.status === 401, true, 'Patch on someone else row returns 403/401 (no grant) or 200 with 0 rows (RLS)');
  if (runUpdateB.status === 200) {
    assertEqual(Array.isArray(runUpdateB.json) && runUpdateB.json.length, 0, 'Patch should return 0 modified rows');
  }

  console.log('Testing Anon access...');
  const runsAnon = await fetchResource(tokenAnon, 'meta_sync_runs');
  assertEqual(runsAnon.status === 401 || runsAnon.status === 400 || runsAnon.status === 404, true, 'Anon should receive 4xx for reading');

  console.log('Testing RPC execution security...');
  const rpcResAnon = await fetchResource(tokenAnon, 'rpc/persist_meta_sync_run', 'POST', {});
  assertEqual(rpcResAnon.status === 404 || rpcResAnon.status === 401 || rpcResAnon.status === 400, true, 'Anon should get 4xx for RPC');

  const rpcResAuth = await fetchResource(tokenA, 'rpc/persist_meta_sync_run', 'POST', {});
  assertEqual(rpcResAuth.status, 404, 'Authenticated should get exactly 404 (Not Found) for RPC due to revoked EXECUTE privilege');

  const testRunId = crypto.randomUUID();
  try {
    execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -q -U postgres -d postgres -c "
      INSERT INTO meta_sync_runs (id, user_id, integration_id, ad_account_id, graph_api_version, requested_period, status) 
      VALUES ('${testRunId}', '${userA}', '${integrationA}', '${adAccountA}', 'v20.0', 'last_7d', 'running');
    "`);
  } catch (err) {
    console.error('Failed to insert test run', err.message);
  }

  const rpcResService = await fetchResource(tokenServiceRole, 'rpc/persist_meta_sync_run', 'POST', {
    p_run_id: testRunId,
    p_user_id: userA,
    p_integration_id: integrationA,
    p_ad_account_id: adAccountA,
    p_final_status: 'success',
    p_raw_snapshots: [],
    p_campaign_entities: [],
    p_adset_entities: [],
    p_normalized_metrics: [],
    p_ad_entities: [],
    p_creative_entities: [],
    p_metadata: {},
    p_pages_fetched: 0,
    p_records_fetched: 0
  });
  if (rpcResService.status !== 200 && rpcResService.status !== 204) {
    console.error('RPC failed:', rpcResService.status, rpcResService.json);
  }
  assertEqual(rpcResService.status === 204 || rpcResService.status === 200, true, 'Service role should successfully execute RPC and return 204/200');

  console.log('✅ RLS and API Security validated');
}

run().catch(err => {
  console.error('Test script failed:', err);
  process.exit(1);
});
