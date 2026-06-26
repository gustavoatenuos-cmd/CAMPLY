// supabase/functions/_shared/meta-api.ts

// Helper function to generate appsecret_proof for Meta Graph API server-to-server calls
// https://developers.facebook.com/docs/graph-api/security#appsecret_proof
export async function generateAppSecretProof(accessToken: string, appSecret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(appSecret);
  const data = encoder.encode(accessToken);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, data);
  const signatureArray = Array.from(new Uint8Array(signature));
  return signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const META_GRAPH_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export interface MetaApiOptions {
  endpoint: string;
  method?: 'GET' | 'POST' | 'DELETE';
  accessToken: string;
  appSecret: string;
  params?: Record<string, string>;
  body?: any;
}

export async function fetchMetaGraph(options: MetaApiOptions) {
  const { endpoint, method = 'GET', accessToken, appSecret, params = {}, body } = options;
  
  const appsecret_proof = await generateAppSecretProof(accessToken, appSecret);
  
  const url = new URL(`${META_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`);
  url.searchParams.append('access_token', accessToken);
  url.searchParams.append('appsecret_proof', appsecret_proof);
  
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }

  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Accept': 'application/json',
    },
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    fetchOptions.headers = {
      ...fetchOptions.headers,
      'Content-Type': 'application/json',
    };
    fetchOptions.body = JSON.stringify(body);
  }

  // Basic retry logic for rate limits (optional enhancement: exponential backoff)
  let retries = 3;
  while (retries > 0) {
    const response = await fetch(url.toString(), fetchOptions);
    const data = await response.json();

    if (!response.ok) {
      // Check for rate limit (usually code 4 or 17 in Meta Graph API)
      if (data.error && (data.error.code === 4 || data.error.code === 17 || data.error.code === 32 || data.error.code === 613)) {
        retries--;
        if (retries === 0) throw new Error(`Meta API Rate Limit hit: ${data.error.message}`);
        // Wait 2 seconds before retry
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      throw new Error(`Meta API Error [${data.error?.code}]: ${data.error?.message}`);
    }

    return data;
  }
}
