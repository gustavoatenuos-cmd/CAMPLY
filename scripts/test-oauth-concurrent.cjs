const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const RESULT_FILE = '/tmp/camply-oauth-result.json';

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function run() {
  console.log('--- TEST: OAuth Concurrent ---');
  await fetch('http://127.0.0.1:9999/reset');
  fs.rmSync(RESULT_FILE, { force: true });

  const userId = crypto.randomUUID();
  const rawState = crypto.randomBytes(32).toString('hex');
  const hashedState = crypto.createHash('sha256').update(rawState).digest('hex');
  const email = `oauth_${Date.now()}@camply.test`;

  execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
    INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${userId}', '${email}', '{}');
    INSERT INTO meta_oauth_states (state_hash, user_id, redirect_uri, scopes, expires_at)
    VALUES ('${hashedState}', '${userId}', 'http://localhost/callback', ARRAY['ads_read'], now() + interval '10 minutes');
  "`);

  const callbackUrl = `http://127.0.0.1:54321/functions/v1/meta-oauth-callback?state=${encodeURIComponent(rawState)}&code=mock_code_123`;
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => fetch(callbackUrl, { method: 'GET', redirect: 'manual' }))
  );

  const statuses = responses.map((response) => response.status);
  const successCount = statuses.filter((status) => status === 302).length;
  const rejectionCount = statuses.length - successCount;

  assertEqual(successCount, 1, 'Exactly one callback should succeed');
  assertEqual(rejectionCount, 4, 'Exactly four callbacks should be rejected');

  const statsResponse = await fetch('http://127.0.0.1:9999/test-stats');
  assertEqual(statsResponse.status, 200, 'Mock stats endpoint should respond');
  const stats = await statsResponse.json();

  assertEqual(stats.oauth_short_token_exchange_count, 1, 'Exactly one short-token exchange should occur');
  assertEqual(stats.oauth_long_token_exchange_count, 1, 'Exactly one long-token exchange should occur');
  assertEqual(stats.oauth_me_count, 1, 'Exactly one profile request should occur');

  const integrationsCount = execSync(
    `PGPASSWORD=postgres docker exec -i supabase_db_camply psql -q -U postgres -d postgres -t -c "SELECT count(*) FROM meta_integrations WHERE user_id = '${userId}';"`
  ).toString().trim();
  assertEqual(integrationsCount, '1', 'Exactly one integration should be persisted');

  const result = {
    success_count: successCount,
    rejection_count: rejectionCount,
    short_exchange_count: stats.oauth_short_token_exchange_count,
    long_exchange_count: stats.oauth_long_token_exchange_count,
    profile_count: stats.oauth_me_count,
    integrations_count: Number(integrationsCount),
  };
  fs.writeFileSync(RESULT_FILE, JSON.stringify(result));
  console.log('✅ OAuth Concurrent validated');
}

run().catch((error) => {
  fs.rmSync(RESULT_FILE, { force: true });
  console.error('OAuth concurrent test failed:', error.message);
  process.exit(1);
});
