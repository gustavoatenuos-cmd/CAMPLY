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

  const restUrl = 'http://127.0.0.1:54321/rest/v1';
  
  async function checkResource(token, endpoint) {
    const res = await fetch(`${restUrl}/${endpoint}`, {
      headers: {
        'apikey': 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
        'Authorization': `Bearer ${token}`
      }
    });
    const json = await res.json();
    return json;
  }

  console.log('Testing User A access...');
  const runsA = await checkResource(tokenA, 'meta_sync_runs');
  if (runsA.error || runsA.code || !Array.isArray(runsA)) {
     console.log("Error querying runsA:", runsA);
  }
  assertEqual(Array.isArray(runsA) && runsA.length > 0, true, 'User A should see their runs');

  console.log('Testing User B access...');
  const runsB = await checkResource(tokenB, 'meta_sync_runs');
  assertEqual(Array.isArray(runsB) && runsB.length, 0, 'User B should NOT see A runs');
  
  const snapsB = await checkResource(tokenB, 'meta_campaign_snapshots');
  assertEqual(Array.isArray(snapsB) && snapsB.length, 0, 'User B should NOT see A campaign snapshots');
  
  const metricsB = await checkResource(tokenB, 'meta_normalized_metrics');
  assertEqual(Array.isArray(metricsB) && metricsB.length, 0, 'User B should NOT see A metrics');

  console.log('Testing Anon access...');
  const runsAnon = await checkResource(tokenAnon, 'meta_sync_runs');
  console.log('Anon output:', runsAnon);
  assertEqual(runsAnon.code === '401' || runsAnon.code === '42501' || runsAnon.code === '22P02' || (Array.isArray(runsAnon) && runsAnon.length === 0) || runsAnon.error === 'invalid_token', true, 'Anon should be rejected or see 0 runs depending on policy');

  console.log('Testing RPC execution security...');
  const rpcResAnon = await fetch(`${restUrl}/rpc/persist_meta_sync_run`, {
    method: 'POST',
    headers: {
      'apikey': 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
      'Authorization': `Bearer ${tokenAnon}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  assertEqual(rpcResAnon.status === 404 || rpcResAnon.status === 401 || rpcResAnon.status === 403, true, 'Anon should not execute RPC');

  const rpcResAuth = await fetch(`${restUrl}/rpc/persist_meta_sync_run`, {
    method: 'POST',
    headers: {
      'apikey': 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  assertEqual(rpcResAuth.status === 404 || rpcResAuth.status === 401 || rpcResAuth.status === 403, true, 'Authenticated should not execute RPC');

  console.log('✅ RLS and API Security validated');
}

run().catch(err => {
  console.error('Test script failed:', err);
  process.exit(1);
});
