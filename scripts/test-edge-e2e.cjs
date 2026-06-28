const { execSync } = require('child_process');

async function runScenario(scenarioName, accountId, accessToken, runAssertions) {
  console.log(`\n\n--- Running Scenario: ${scenarioName} (${accountId}) ---`);
  
  let res, text, json;
  try {
    res = await fetch('http://127.0.0.1:54321/functions/v1/meta-sync-ads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        adAccountId: accountId,
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
  
  console.log('Status:', res.status, 'Payload:', JSON.stringify(json));
  
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

  const cryptoLib = require('crypto');
  const encryptOut = execSync(`node scripts/encrypt-token.cjs "mock_token"`).toString().trim();
  const integrationId = cryptoLib.randomUUID();

  execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -c "
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    INSERT INTO meta_integrations (id, user_id, access_token_encrypted, status) VALUES ('${integrationId}', '${userId}', '${encryptOut}', 'active');
  "`);

  const assertEqual = (actual, expected, msg) => { if(actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`); };

  // Setup mock assets in DB
  const setupAccount = (act) => execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -c "INSERT INTO meta_assets (id, integration_id, asset_id, asset_type, asset_name) VALUES ('${cryptoLib.randomUUID()}', '${integrationId}', '${act}', 'adaccount', 'Mock ${act}');"`);
  
  setupAccount('act_simple');
  setupAccount('act_zero');
  setupAccount('act_mixed_obj');
  setupAccount('act_mixed_attr');
  setupAccount('act_partial');
  setupAccount('act_error');

  // Scenario 1: act_simple
  await runScenario('Simple Sync', 'act_simple', accessToken, (res, json, q) => {
    assertEqual(res.status, 200, 'HTTP Status');
    assertEqual(json.success, true, 'JSON Success');
    assertEqual(json.status, 'success', 'JSON Status');
    if (!json.runId) throw new Error('Missing runId');
    
    assertEqual(q(`SELECT status FROM meta_sync_runs WHERE id='${json.runId}'`), 'success', 'DB run status');
    assertEqual(q(`SELECT count(*) FROM meta_raw_snapshots WHERE sync_run_id='${json.runId}'`), '1', 'DB raw snapshots');
    assertEqual(q(`SELECT count(*) FROM meta_campaign_entities WHERE ad_account_id='act_simple'`), '1', 'DB campaigns');
    assertEqual(q(`SELECT count(*) FROM meta_adset_entities WHERE ad_account_id='act_simple'`), '1', 'DB adsets');
    assertEqual(q(`SELECT completeness_status FROM meta_normalized_metrics WHERE sync_run_id='${json.runId}' LIMIT 1`), 'complete', 'DB completeness');
  });

  // Scenario 2: act_zero
  await runScenario('Zero Delivery', 'act_zero', accessToken, (res, json, q) => {
    assertEqual(res.status, 200, 'HTTP Status');
    assertEqual(json.success, true, 'JSON Success');
    assertEqual(json.status, 'success', 'JSON Status');
    assertEqual(q(`SELECT status FROM meta_sync_runs WHERE id='${json.runId}'`), 'success', 'DB run status');
    assertEqual(q(`SELECT count(*) FROM meta_normalized_metrics WHERE sync_run_id='${json.runId}' AND metric_value > 0`), '0', 'All metrics should be zero or missing');
    assertEqual(q(`SELECT completeness_status FROM meta_normalized_metrics WHERE sync_run_id='${json.runId}' LIMIT 1`), 'zero_delivery', 'DB completeness');
  });

  // Scenario 3: act_mixed_obj
  await runScenario('Mixed Objective', 'act_mixed_obj', accessToken, (res, json, q) => {
    assertEqual(res.status, 200, 'HTTP Status');
    assertEqual(json.success, true, 'JSON Success');
    assertEqual(json.campaigns[0].mixedObjective, true, 'JSON mixedObjective');
    assertEqual(json.campaigns[0].mixedAttribution, false, 'JSON mixedAttribution');
    assertEqual(q(`SELECT classified_objective FROM meta_campaign_entities WHERE ad_account_id='act_mixed_obj'`), 'MIXED', 'Campaign Objective');
    assertEqual(q(`SELECT count(*) FROM meta_adset_entities WHERE ad_account_id='act_mixed_obj'`), '2', 'DB adsets');
  });

  // Scenario 4: act_mixed_attr
  await runScenario('Mixed Attribution', 'act_mixed_attr', accessToken, (res, json, q) => {
    assertEqual(res.status, 200, 'HTTP Status');
    assertEqual(json.success, true, 'JSON Success');
    assertEqual(json.campaigns[0].mixedAttribution, true, 'JSON mixedAttribution');
    
    const adsets = q(`SELECT count(*) FROM meta_adset_entities WHERE ad_account_id='act_mixed_attr'`);
    assertEqual(adsets, '2', 'Should have 2 adsets');
    
    // CPA and ROAS should NOT be consolidated at campaign level. Source level = adset
    const campaignRoas = q(`SELECT count(*) FROM meta_normalized_metrics WHERE sync_run_id='${json.runId}' AND metric_id='purchase_roas' AND source_level='campaign'`);
    assertEqual(campaignRoas, '0', 'No campaign-level ROAS for mixed attribution');
    
    const adsetRoas = q(`SELECT count(*) FROM meta_normalized_metrics WHERE sync_run_id='${json.runId}' AND metric_id='purchase_roas' AND source_level='adset'`);
    assertEqual(adsetRoas, '2', '2 Adset-level ROAS for mixed attribution');
  });

  // Scenario 5: act_partial (First pass: Complete)
  console.log('\n--- act_partial setup pass (Complete) ---');
  let firstPartialRunId = await runScenario('Partial Sync (Setup Complete)', 'act_partial', accessToken, (res, json, q) => {
    assertEqual(res.status, 200, 'HTTP Status');
    assertEqual(json.success, true, 'JSON Success');
  });

  // Scenario 5: act_partial (Second pass: Partial)
  await runScenario('Partial Sync (Failure on Page 2)', 'act_partial', accessToken, (res, json, q) => {
    assertEqual(res.status, 200, 'HTTP Status');
    assertEqual(json.success, false, 'JSON Success is false for partial');
    assertEqual(json.status, 'partial', 'JSON Status is partial');
    
    const currentRunId = json.runId;
    assertEqual(q(`SELECT status FROM meta_sync_runs WHERE id='${currentRunId}'`), 'partial', 'DB run status is partial');
    
    // Prove previous snapshot preservation!
    const previousRunStatus = q(`SELECT status FROM meta_sync_runs WHERE id='${firstPartialRunId}'`);
    assertEqual(previousRunStatus, 'success', 'Previous complete run remains successful');
  });

  // Scenario 6: act_error
  await runScenario('API Error', 'act_error', accessToken, (res, json, q) => {
    assertEqual(res.status, 502, 'HTTP Status');
    assertEqual(json.isError, true, 'JSON isError');
    assertEqual(json.error.includes('Meta campaign collection failed'), true, 'JSON error message');
    
    // DB run status is updated in the catch block if runId exists, but the payload doesn't return runId on 500/502
    // We check if the last run for act_error is failed instead
    const runStatus = q(`SELECT status FROM meta_sync_runs WHERE ad_account_id='act_error' ORDER BY created_at DESC LIMIT 1`);
    assertEqual(runStatus, 'failed', 'DB run status is failed');
  });

  console.log('\n\n=== ALL E2E SCENARIOS PASSED ===');
  process.exit(0);
}

run();
