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

export const META_GRAPH_VERSION = // @ts-ignore
    (typeof Deno !== "undefined" ? Deno.env.get : () => "")('META_GRAPH_VERSION') || 'v25.0';
export const META_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export interface MetaApiOptions {
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  accessToken: string;
  appSecret: string;
  params?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagesFetched: number;
  recordsFetched: number;
  isPartial: boolean;
  errorMessage?: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function getExponentialBackoffWithJitter(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const backoff = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = Math.random() * (backoff * 0.2); // 20% jitter
  return backoff + jitter;
}

export async function fetchMetaGraph(options: MetaApiOptions & { rawUrl?: string }) {
  const { endpoint, method = 'GET', accessToken, appSecret, params = {}, body, timeoutMs = 15000, rawUrl } = options;
  
  let urlStr = rawUrl;
  if (!urlStr) {
    const appsecret_proof = await generateAppSecretProof(accessToken, appSecret);
    const url = new URL(`${META_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`);
    url.searchParams.append('appsecret_proof', appsecret_proof);
    
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.append(key, value);
    }
    urlStr = url.toString();
  } else {
    // rawUrl already has paging parameters, but we must assure appsecret_proof is present if not
    const url = new URL(urlStr);
    if (!url.searchParams.has('appsecret_proof')) {
       const appsecret_proof = await generateAppSecretProof(accessToken, appSecret);
       url.searchParams.append('appsecret_proof', appsecret_proof);
    }
    urlStr = url.toString();
  }

  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    fetchOptions.headers = {
      ...fetchOptions.headers,
      'Content-Type': 'application/json',
    };
    fetchOptions.body = JSON.stringify(body);
  }

  let retries = 0;
  const maxRetries = 4;

  while (retries <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(urlStr, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await response.json();

      if (!response.ok) {
        // Rate limit codes: 4, 17, 32, 613 (and 8000x for Ads API)
        const isRateLimit = data.error && (data.error.code === 4 || data.error.code === 17 || data.error.code === 32 || data.error.code === 613 || (data.error.code >= 80000 && data.error.code <= 80009));
        
        if (isRateLimit && retries < maxRetries) {
          const waitTime = getExponentialBackoffWithJitter(retries);
          console.warn(`Meta API Rate Limit hit [Code: ${data.error.code}]. Retrying in ${Math.round(waitTime)}ms... (Attempt ${retries + 1})`);
          await sleep(waitTime);
          retries++;
          continue;
        }
        
        // If it's a transient server error
        if (response.status >= 500 && retries < maxRetries) {
          const waitTime = getExponentialBackoffWithJitter(retries);
          await sleep(waitTime);
          retries++;
          continue;
        }
        
        throw new Error(`Meta API Error [${data.error?.code || response.status}]: ${data.error?.message || response.statusText}`);
      }

      return data;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if ((error.name === 'AbortError' || error.message.includes('fetch failed')) && retries < maxRetries) {
        const waitTime = getExponentialBackoffWithJitter(retries);
        console.warn(`Network error or timeout. Retrying in ${Math.round(waitTime)}ms...`);
        await sleep(waitTime);
        retries++;
        continue;
      }
      throw error;
    }
  }
}

export async function fetchMetaGraphPaginated<T = any>(
  options: MetaApiOptions, 
  maxPages = 10,
  maxRecords = 5000
): Promise<PaginatedResult<T>> {
  const result: PaginatedResult<T> = {
    data: [],
    pagesFetched: 0,
    recordsFetched: 0,
    isPartial: false
  };

  try {
    let currentData = await fetchMetaGraph(options);
    result.pagesFetched++;
    
    if (currentData.data && Array.isArray(currentData.data)) {
      result.data.push(...currentData.data);
      result.recordsFetched += currentData.data.length;
    }

    let nextUrl = currentData.paging?.next;

    while (nextUrl && result.pagesFetched < maxPages && result.recordsFetched < maxRecords) {
      currentData = await fetchMetaGraph({
        ...options,
        rawUrl: nextUrl
      });
      
      result.pagesFetched++;
      
      if (currentData.data && Array.isArray(currentData.data)) {
        result.data.push(...currentData.data);
        result.recordsFetched += currentData.data.length;
      }
      
      nextUrl = currentData.paging?.next;
    }

    if (nextUrl) {
      result.isPartial = true;
      console.warn(`fetchMetaGraphPaginated stopped early. Pages: ${result.pagesFetched}, Records: ${result.recordsFetched}`);
    }

  } catch (error: any) {
    result.isPartial = true;
    result.errorMessage = error.message;
    console.error(`fetchMetaGraphPaginated partial failure: ${error.message}`);
    // If we have some data, we return it as partial success instead of completely throwing away the progress
    if (result.recordsFetched === 0) {
      throw error;
    }
  }

  return result;
}
