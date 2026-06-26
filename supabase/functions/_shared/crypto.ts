// supabase/functions/_shared/crypto.ts
// Encrypts and decrypts strings using AES-GCM

const ALGORITHM = 'AES-GCM';

// Helper to convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Helper to convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const keyString = Deno.env.get('META_TOKEN_ENCRYPTION_KEY');
  if (!keyString) {
    throw new Error('META_TOKEN_ENCRYPTION_KEY is missing from environment variables');
  }
  
  // Ensure the key string is precisely 32 bytes for AES-256
  // For simplicity, we hash the provided string with SHA-256 to guarantee a 32-byte key
  const keyMaterial = new TextEncoder().encode(keyString);
  const hash = await crypto.subtle.digest('SHA-256', keyMaterial);

  return await crypto.subtle.importKey(
    'raw',
    hash,
    { name: ALGORITHM },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptToken(token: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  const encodedText = new TextEncoder().encode(token);

  const encryptedBuf = await crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv: iv,
    },
    key,
    encodedText
  );

  const encryptedBytes = new Uint8Array(encryptedBuf);
  // Store format: IV(hex):EncryptedData(hex)
  return `${bytesToHex(iv)}:${bytesToHex(encryptedBytes)}`;
}

export async function decryptToken(encryptedToken: string): Promise<string> {
  const parts = encryptedToken.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted token format');
  }

  const iv = hexToBytes(parts[0]);
  const encryptedBytes = hexToBytes(parts[1]);
  const key = await getEncryptionKey();

  const decryptedBuf = await crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv: iv,
    },
    key,
    encryptedBytes
  );

  return new TextDecoder().decode(decryptedBuf);
}
