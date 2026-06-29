const { execSync } = require('child_process');
const cryptoLib = require('crypto');

async function runScenario(scenarioName, metaAssetId, accessToken, runAssertions) {
  console.log(`\n\n--- Running Scenario: ${scenarioName} ---`);
  
  let res, text, json;
  try {
    res = await fetch('http://127.0.0.1:54321/functions/v1/meta-sync-ads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        metaAssetId: metaAssetId,
        periods: ['today']
      })
    });
    
    text = await res.text();
    try {
      json = JSON.parse(text);
    } catch(e) {
      json = null;
    }
  } catch(e) {
    console.error(`HTTP request failed:`, e);
    process.exit(1);
  }
  
  // MASKING: Do not print full payload! Just a summary.
  console.log(`Status: ${res.status}`);
  console.log(`RunID: ${json?.runId ? json.runId.substring(0, 8) + '...' : 'none'}`);
  console.log(`Success: ${json?.success}, Error Code: ${json?.error?.code || 'none'}`);
  
  const queryDB = (query) => {
    return execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -t -c "${query}"`).toString().trim();
  };

  try {
    runAssertions(res, json, queryDB);
    console.log(`✅ Scenario ${scenarioName} passed.`);
    return json?.runId;
  } catch (err) {
    console.error(`❌ Scenario ${scenarioName} failed!`);
    console.error(err.message);
    process.exit(1);
  }
}

async function run() {
  console.log('Running E2E Edge Function test...');

  const statusOut = execSync('npx supabase status --output json').toString();
  const status = JSON.parse(statusOut);
  const anonKey = status.ANON_KEY;
  const apiUrl = status.API_URL;

  const signupRes = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
    body: JSON.stringify({ email: `test_${Date.now()}@camply.com`, password: 'password123' })
  });
  
  const signupData = await signupRes.json();
  const accessToken = signupData.access_token;
  const userId = signupData?.user?.id;
  
  if (!accessToken || !userId) {
     console.error('Failed to create user');
     process.exit(1);
  }

  const encryptOut = execSync(`node scripts/encrypt-token.cjs "mock_token"`).toString().trim();
  const integrationId = cryptoLib.randomUUID();

  // ONLY setup data, no GRANT ALL. We rely on service_role for edge function, and API for RLS.
  execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -c "
    INSERT INTO meta_integrations (id, user_id, access_token_encrypted, status) VALUES ('${integrationId}', '${userId}', '${encryptOut}', 'active');
  "`);

  const assertEqual = (actual, expected, msg) => { if(actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`); };

  // Setup mock assets in DB
  const setupAccount = (act, intId = integrationId) => {
    const assetId = cryptoLib.randomUUID();
    execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -c "INSERT INTO meta_assets (id, integration_id, asset_id, asset_type, asset_name) VALUES ('${assetId}', '${intId}', '${act}', 'adaccount', 'Mock ${act}');"`);
    return assetId;
  };
  
  const assets = {
    simple: setupAccount('act_simple'),
    zero: setupAccount('act_zero'),
    mixedObj: setupAccount('act_mixed_obj'),
    mixedAttr: setupAccount('act_mixed_attr'),
    mixedDest: setupAccount('act_mixed_dest'),
    partial: setupAccount('act_partial'),
    error: setupAccount('act_error'),
    timeout: setupAccount('act_timeout'),
    rateLimit: setupAccount('act_rate_limit'),
    invalidPayload: setupAccount('act_invalid_payload'),
    unauthorized: setupAccount('act_unauthorized'),
    ssrf: setupAccount('act_ssrf')
  };

  // foreign ad account setup (different user)
  const foreignUserId = cryptoLib.randomUUID();
  const foreignEmail = `foreign_${Date.now()}@test.com`;
  const foreignIntegrationId = cryptoLib.randomUUID();
  execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -q -U postgres -d postgres -c "
    INSERT INTO auth.users (id, email) VALUES ('${foreignUserId}', '${foreignEmail}');
    INSERT INTO meta_integrations (id, user_id, access_token_encrypted, status) VALUES ('${foreignIntegrationId}', '${foreignUserId}', 'token', 'active');
  "`);
  const foreignAsset = setupAccount('act_foreign', foreignIntegrationId);

  // SCENARIO: RLS and Permissions Blocking
  console.log(`\n\n--- Running Scenario: RLS / RPC Access Control ---`);
  const rpcAnon = execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -q -U postgres -d postgres -c "SELECT has_function_privilege('anon', 'persist_meta_sync_run(UUID, UUID, UUID, VARCHAR, VARCHAR, JSONB, JSONB[], JSONB[], JSONB[], JSONB[], INT, INT)', 'EXECUTE');" -t`).toString().trim();
  assertEqual(rpcAnon, 'f', 'Anon should NOT have execute on persist_meta_sync_run');
  const rpcAuth = execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -q -U postgres -d postgres -c "SELECT has_function_privilege('authenticated', 'consume_meta_oauth_state(VARCHAR)', 'EXECUTE');" -t`).toString().trim();
  assertEqual(rpcAuth, 'f', 'Auth should NOT have execute on consume_meta_oauth_state');
  console.log(`✅ Scenario RLS / RPC Access Control passed.`);

  // Scenario 1: act_simple
  await fetch('http://localhost:9999/reset');
  await runScenario('Simple Sync', assets.simple, accessToken, (res, json, q) => {
    assertEqual(res.status, 200, 'HTTP Status');
    assertEqual(json.success, true, 'JSON Success');
    
    // Test historical completeness (campaign and adset metrics both saved)
    const metricsCount = q(`SELECT count(*) FROM meta_normalized_metrics WHERE sync_run_id='${json.runId}'`);
    if(parseInt(metricsCount) < 2) throw new Error('Should have global and adset metrics for simple');
  });

  // Scenario 2: act_zero
  await fetch('http://localhost:9999/reset');
  await runScenario('Zero Delivery', assets.zero, accessToken, (res, json, q) => {
    assertEqual(res.status, 200, 'HTTP Status');
    assertEqual(json.success, true, 'JSON Success');
  });

  // Scenario 3: mixed_dest
  await fetch('http://localhost:9999/reset');
  await runScenario('Mixed Destination', assets.mixedDest, accessToken, (res, json, q) => {
    assertEqual(res.status, 200, 'HTTP Status');
    assertEqual(json.success, true, 'JSON Success');
    const adsets = q(`SELECT count(*) FROM meta_adset_entities WHERE sync_run_id='${json.runId}'`);
    if (adsets !== '2') {
      const allAdsets = q(`SELECT row_to_json(a) FROM meta_adset_entities a`);
      console.log('All Adsets:', allAdsets);
    }
    assertEqual(adsets, '2', '2 Adsets for mixed destination');
  });

  // Scenario 4: foreign_ad_account
  await fetch('http://localhost:9999/reset');
  await runScenario('Foreign Ad Account', foreignAsset, accessToken, (res, json, q) => {
    assertEqual(res.status, 403, 'HTTP Status');
    assertEqual(json.success, false, 'JSON Success');
  });

  // Scenario 5: rate_limit
  await fetch('http://localhost:9999/reset');
  await runScenario('Rate Limit Exhausted', assets.rateLimit, accessToken, (res, json, q) => {
    assertEqual(res.status, 502, 'HTTP Status'); // Edge function catches it and returns 502/500 wrapped
    assertEqual(json.success, false, 'JSON Success');
  });

  // Scenario 6: ssrf
  await fetch('http://localhost:9999/reset');
  await runScenario('SSRF Paging URL', assets.ssrf, accessToken, (res, json, q) => {
    // Edge function fetchMetaGraphPaginated catches network error and returns partial success (200 OK, success: false)
    assertEqual(res.status, 200, 'HTTP Status for SSRF attempt (partial sync)');
    assertEqual(json.success, false, 'SSRF should result in partial sync (success: false)');
  });

  // Scenario 7: act_partial
  await fetch('http://localhost:9999/reset');
  const partialRunId1 = await runScenario('Partial Sync (Setup Complete)', assets.partial, accessToken, (res, json, q) => {
    assertEqual(json.success, true, 'First pass is complete');
  });
  
  const partialRunId2 = await runScenario('Partial Sync (Failure on Page 2)', assets.partial, accessToken, (res, json, q) => {
    assertEqual(res.status, 200, 'HTTP Status');
    assertEqual(json.status, 'partial', 'JSON Status is partial');
    
    // UI/Dashboard logic test: It should not use the partial run for totals
    // (We simulate this by checking if partialRunId1 is still the last SUCCESSFUL run)
    const lastSuccess = q(`SELECT id FROM meta_sync_runs WHERE ad_account_id='act_partial' AND status='success' ORDER BY created_at DESC LIMIT 1`);
    assertEqual(lastSuccess, partialRunId1, 'Dashboard reconciler must select the previous complete run');
  });

  console.log('\n\n=== ALL E2E SCENARIOS PASSED ===');
  process.exit(0);
}

run();
