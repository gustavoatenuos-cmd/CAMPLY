const { execSync } = require('child_process');

async function run() {
  console.log('Running E2E Edge Function test...');

  // 1. Get anon key
  const statusOut = execSync('npx supabase status --output json').toString();
  const status = JSON.parse(statusOut);
  const anonKey = status.ANON_KEY;
  const apiUrl = status.API_URL;

  // 2. Signup a user to get a valid JWT
  const signupRes = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
    },
    body: JSON.stringify({
      email: `test_${Date.now()}@camply.com`,
      password: 'password123'
    })
  });
  
  const signupData = await signupRes.json();
  const accessToken = signupData.access_token;
  const userId = signupData.user.id;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  
  if (!accessToken || !userId) {
     console.error('Failed to create user', signupData);
     process.exit(1);
  }

  // Insert mock integration using psql directly to bypass REST issues
  execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -c "
    INSERT INTO meta_integrations (id, user_id, access_token_encrypted, status) 
    VALUES ('11111111-1111-1111-1111-111111111111', '${userId}', 'mock_token', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO meta_assets (id, integration_id, asset_id, asset_type, asset_name) 
    VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'act_123', 'ad_account', 'Mock Account') ON CONFLICT DO NOTHING;
  "`);

  // 3. Call Edge Function
  const res = await fetch('http://127.0.0.1:54321/functions/v1/meta-sync-ads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      integrationId: '11111111-1111-1111-1111-111111111111',
      adAccountId: 'act_123',
      graphApiVersion: 'v20.0',
      accessToken: 'mock_token',
      requestedPeriod: 'today'
    })
  });

  const text = await res.text();
  console.log('Edge Function HTTP Response:', res.status, text);

  if (!res.ok) {
    console.error('Test failed: non-200 response');
    process.exit(1);
  }
  console.log('E2E validation passed.');
  process.exit(0);
}

run();
