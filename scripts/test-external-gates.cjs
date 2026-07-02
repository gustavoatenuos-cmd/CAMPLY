const fs = require('fs');

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const oauth = JSON.parse(fs.readFileSync('/tmp/camply-oauth-result.json', 'utf8'));
const rls = JSON.parse(fs.readFileSync('/tmp/camply-rls-result.json', 'utf8'));

assertEqual(oauth.success_count, 1, 'OAuth success count');
assertEqual(oauth.rejection_count, 4, 'OAuth rejection count');
assertEqual(oauth.short_exchange_count, 1, 'OAuth first exchange count');
assertEqual(oauth.long_exchange_count, 1, 'OAuth second exchange count');
assertEqual(oauth.profile_count, 1, 'OAuth profile count');
assertEqual(oauth.integrations_count, 1, 'OAuth integration count');

assertEqual(rls.resources_checked, 5, 'RLS resources checked');
assertEqual(rls.foreign_asset_status, 403, 'RLS foreign asset status');
assertEqual(rls.rpc_privileges, 'f,f,t', 'RPC privilege matrix');

console.log('✅ External OAuth and RLS gates validated.');
