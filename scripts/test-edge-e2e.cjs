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
  const userId = signupData?.user?.id;
  
  if (!accessToken || !userId) {
     console.error('Failed to create user', signupData);
     process.exit(1);
  }

  // 3. Encrypt the mock token using Node script
  const encryptOut = execSync(`node scripts/encrypt-token.cjs "mock_token"`).toString().trim();

  const cryptoLib = require('crypto');
  const integrationId = cryptoLib.randomUUID();
  const assetId = cryptoLib.randomUUID();

  // 4. Insert mock integration using psql directly to bypass REST issues
  execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -c "
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    
    INSERT INTO meta_integrations (id, user_id, access_token_encrypted, status) 
    VALUES ('${integrationId}', '${userId}', '${encryptOut}', 'active');
    INSERT INTO meta_assets (id, integration_id, asset_id, asset_type, asset_name) 
    VALUES ('${assetId}', '${integrationId}', 'act_123', 'adaccount', 'Mock Account');
  "`);

  // 5. Call Edge Function
  const res = await fetch('http://127.0.0.1:54321/functions/v1/meta-sync-ads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      adAccountId: 'act_123',
      periods: ['today']
    })
  });

  const text = await res.text();
  console.log('Edge Function HTTP Response Status:', res.status);
  
  if (!res.ok) {
    console.error('Test failed: non-200 response', text);
    process.exit(1);
  }

  // 6. DB Verification
  const dbOut = execSync(`PGPASSWORD=postgres docker exec -i supabase_db_camply psql -U postgres -d postgres -t -c "
    SELECT count(*) FROM meta_normalized_metrics;
  "`).toString().trim();

  if (parseInt(dbOut, 10) === 0) {
    console.error('Test failed: No metrics found in meta_normalized_metrics');
    process.exit(1);
  }

  console.log(`E2E validation passed. Found ${dbOut} normalized metrics.`);
  process.exit(0);
}

run();
