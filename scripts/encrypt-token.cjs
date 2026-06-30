const fs = require('fs');
const crypto = require('crypto');

function readEncryptionKey() {
  if (process.env.META_TOKEN_ENCRYPTION_KEY) {
    return process.env.META_TOKEN_ENCRYPTION_KEY;
  }

  for (const file of ['supabase/functions/.env', 'supabase/.env.local']) {
    try {
      const contents = fs.readFileSync(file, 'utf8');
      const match = contents.match(/^META_TOKEN_ENCRYPTION_KEY=(.+)$/m);
      if (match?.[1]) return match[1].trim();
    } catch {
      // Continue to the next local environment source.
    }
  }

  throw new Error('META_TOKEN_ENCRYPTION_KEY was not found in the local test environment.');
}

async function run() {
  const algorithm = 'AES-GCM';
  const token = process.argv[2];
  if (!token) throw new Error('A token value is required.');

  const keyMaterial = new TextEncoder().encode(readEncryptionKey());
  const hash = await crypto.subtle.digest('SHA-256', keyMaterial);
  const key = await crypto.subtle.importKey(
    'raw',
    hash,
    { name: algorithm },
    false,
    ['encrypt'],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: algorithm, iv: iv.buffer },
    key,
    new TextEncoder().encode(token),
  );

  const toHex = (bytes) => Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  console.log(`${toHex(iv)}:${toHex(new Uint8Array(encrypted))}`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
