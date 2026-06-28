const fs = require('fs');
const crypto = require('crypto');

async function run() {
  let env = '';
  try {
    env = fs.readFileSync('supabase/.env.local', 'utf8');
  } catch(e) {}
  
  const match = env.match(/META_TOKEN_ENCRYPTION_KEY=([^\n]+)/);
  const keyString = match ? match[1].trim() : 'super-secret-meta-encryption-key-that-is-at-least-32-chars-long';

  const ALGORITHM = 'AES-GCM';
  const token = process.argv[2] || 'mock_token';

  const keyMaterial = new TextEncoder().encode(keyString);
  const hash = await crypto.subtle.digest('SHA-256', keyMaterial);

  const key = await crypto.subtle.importKey(
    'raw',
    hash,
    { name: ALGORITHM },
    false,
    ['encrypt', 'decrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(token);

  const encryptedBuf = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv.buffer },
    key,
    encodedText
  );

  const bytesToHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  
  console.log(bytesToHex(iv) + ':' + bytesToHex(new Uint8Array(encryptedBuf)));
}

run();
