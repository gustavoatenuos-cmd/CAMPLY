const PASSWORD_HASH = '8b7828d9139747af056e8c4f0512891da90e56b7f16f06da18d48ec604ea8c9d';

export const AUTH_STORAGE_KEY = 'camply-authenticated';

export const verifyPassword = async (password: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return hash === PASSWORD_HASH;
};
