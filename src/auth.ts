const PASSWORD_HASH = '91ed9f1b7253b0c04a2e022b98bada9607d97311c0034761bc62edf219710b2b';

export const AUTH_STORAGE_KEY = 'camply-authenticated';

export const verifyPassword = async (password: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return hash === PASSWORD_HASH;
};
