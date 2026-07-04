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
  console.log('--- TEST: OAuth Concurrent ---');
  
  const userId = crypto.randomUUID();
  const rawState = crypto.randomBytes(32).toString('hex');
  const hashedState = crypto.createHash('sha256').update(rawState).digest('hex');

  console.log('Setup: Inserting User and OAuth State...');
  const email = `oauth_${Date.now()}@camply.test`;
  try {
    execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -q -U postgres -d postgres -c "
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${userId}', '${email}', '{}');
      INSERT INTO meta_oauth_states (state_hash, user_id, redirect_uri, scopes, expires_at) 
      VALUES ('${hashedState}', '${userId}', 'http://localhost/callback', ARRAY['ads_read'], now() + interval '10 minutes');
    "`);
  } catch (err) {
    console.error('Failed setup', err.message);
    process.exit(1);
  }

  // Edge function token exchange endpoint
  const url = `http://127.0.0.1:54321/functions/v1/meta-oauth-callback?state=${encodeURIComponent(rawState)}&code=mock_code_123`;
  
  const headers = { 'Content-Type': 'application/json' };

  // Reset mock
  console.log('Resetting mock graph...');
  await fetch('http://127.0.0.1:9999/reset');

  console.log('Firing 5 concurrent token exchange requests...');
  
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(fetch(url, { method: 'GET', headers, redirect: 'manual' }));
  }

  const responses = await Promise.all(promises);
  
  let successCount = 0;
  let failCount = 0;

  for (const res of responses) {
    const location = res.headers.get('location') || '';
    if (res.status === 302 && location.includes('meta_sync=success')) {
      successCount++;
    } else {
      failCount++;
      console.log('Rejected callback:', res.status, location || await res.text());
    }
  }

  console.log(`Results: ${successCount} Success, ${failCount} Failures`);
  assertEqual(successCount, 1, 'Exactly 1 token exchange should succeed');
  assertEqual(failCount, 4, 'Exactly 4 token exchanges should fail due to race conditions lock');

  // Verify mock stats
  const statsRes = await fetch('http://127.0.0.1:9999/test-stats');
  const stats = await statsRes.json();
  assertEqual(stats.oauth_token_exchange_count, 1, 'Exactly 1 token exchange call made to mock');
  assertEqual(stats.oauth_long_token_exchange_count <= 1, true, 'At most 1 long token exchange call made to mock');
  assertEqual(stats.oauth_me_count, 1, 'Exactly 1 /me call made to mock');

  // Verify DB Integration
  const integrationsCount = execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -q -U postgres -d postgres -c "SELECT count(*) FROM meta_integrations WHERE user_id = '${userId}';" -t`).toString().trim();
  assertEqual(integrationsCount, '1', 'Exactly 1 integration should be persisted in DB');

  console.log('✅ OAuth Concurrent validated');
}

run().catch(err => {
  console.error('Test script failed:', err);
  process.exit(1);
});
