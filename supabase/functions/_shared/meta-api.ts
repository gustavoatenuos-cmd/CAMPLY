import { validateMetaPagingUrl, type PagingValidationConfig } from './meta/ssr_validator.ts';
import { getEnvVar } from './env_adapter.ts';

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

export const META_GRAPH_VERSION = getEnvVar('META_GRAPH_VERSION') || 'v25.0';
export const META_BASE_URL = getEnvVar('META_BASE_URL') || `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export interface MetaApiOptions {
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  accessToken: string;
  appSecret: string;
  params?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagesFetched: number;
  recordsFetched: number;
  isPartial: boolean;
  completionStatus: 'complete' | 'partial_page' | 'timeout' | 'api_error' | 'rate_limit_exhausted';
  errorMessage?: string;
  maxRetries?: number;
}

/** Thrown only when every retry attempt for a rate-limited request (code 4/17/32/613/8000x) is exhausted — lets callers tell "Meta throttled us" apart from a generic API failure. */
export class MetaRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaRateLimitError';
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function getExponentialBackoffWithJitter(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const isTest = getEnvVar('META_TEST_MODE') === 'true';
  if (isTest) {
    return parseInt(getEnvVar('TEST_BACKOFF_MS') || '10', 10); // deterministic, no jitter for tests
  }
  const backoff = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = Math.random() * (backoff * 0.2); // 20% jitter
  return backoff + jitter;
}

export async function fetchMetaGraph(options: MetaApiOptions) {
  const { endpoint, method = 'GET', accessToken, appSecret, params = {}, body, timeoutMs = 15000 } = options;
  
  const appsecret_proof = await generateAppSecretProof(accessToken, appSecret);
  const url = new URL(`${META_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`);
  url.searchParams.append('appsecret_proof', appsecret_proof);
  
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }
  const urlStr = url.toString();

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
  const maxRetriesOverride = getEnvVar('TEST_MAX_RETRIES');
  const maxRetries = options.maxRetries ?? (maxRetriesOverride ? parseInt(maxRetriesOverride, 10) : 4);
  
  const timeoutOverride = getEnvVar('TEST_TIMEOUT_MS');
  const actualTimeoutMs = timeoutOverride ? parseInt(timeoutOverride, 10) : timeoutMs;

  while (retries <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), actualTimeoutMs);
    
    try {
      const response = await fetch(urlStr, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await response.json();

      if (!response.ok) {
        // Rate limit codes: 4, 17, 32, 613 (and 8000x for Ads API)
        const isRateLimit = data.error && (data.error.code === 4 || data.error.code === 17 || data.error.code === 32 || data.error.code === 613 || (data.error.code >= 80000 && data.error.code <= 80009));
        
        if (isRateLimit) {
          if (retries < maxRetries) {
            const waitTime = getExponentialBackoffWithJitter(retries);
            console.warn(`Meta API Rate Limit hit [Code: ${data.error.code}]. Retrying in ${Math.round(waitTime)}ms... (Attempt ${retries + 1})`);
            await sleep(waitTime);
            retries++;
            continue;
          }
          throw new MetaRateLimitError(`Meta API rate limit exhausted after ${retries} retries [Code: ${data.error.code}]: ${data.error?.message || 'Rate limit exceeded.'}`);
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
    isPartial: false,
    completionStatus: 'complete',
  };

  try {
    let currentData = await fetchMetaGraph(options);
    result.pagesFetched++;
    
    if (currentData.data && Array.isArray(currentData.data)) {
      result.data.push(...currentData.data);
      result.recordsFetched += currentData.data.length;
    }

    let nextUrl = currentData.paging?.next;
    let nextCursor = currentData.paging?.cursors?.after;

    while (nextUrl && result.pagesFetched < maxPages && result.recordsFetched < maxRecords) {
      // Robust SSRF Defense & Paging Rebuild
      // Do not trust paging.next blindly. Validate it, extract cursor, and reconstruct it.
      const environment = getEnvVar('SUPABASE_ENVIRONMENT') === 'production' ? 'production' : 'local';
      const isTestMode = getEnvVar('META_TEST_MODE') === 'true';
      
      const config: PagingValidationConfig = {
        environment,
        testMode: isTestMode,
        allowedProductionHosts: ['graph.facebook.com'],
        allowedTestHosts: ['mock-graph', 'localhost', '127.0.0.1'],
        allowedTestPorts: ['54321', '9999', '']
      };

      const validation = validateMetaPagingUrl(nextUrl, config);
      if (!validation.isValid) {
        throw new Error(`SSRF Blocked: ${validation.reason}`);
      }
      
      const afterCursor = validation.cursorAfter || nextCursor;
      if (!afterCursor) {
        // Without a cursor, we cannot reconstruct the URL safely.
        break;
      }
      
      // Reconstruct the URL securely
      const safeParams = { ...options.params, after: afterCursor };
      
      currentData = await fetchMetaGraph({
        ...options,
        params: safeParams
      });
      
      result.pagesFetched++;
      
      if (currentData.data && Array.isArray(currentData.data)) {
        result.data.push(...currentData.data);
        result.recordsFetched += currentData.data.length;
      }
      
      nextUrl = currentData.paging?.next;
      nextCursor = currentData.paging?.cursors?.after;
    }

    if (nextUrl) {
      result.isPartial = true;
      result.completionStatus = 'partial_page';
      console.warn(`fetchMetaGraphPaginated stopped early. Pages: ${result.pagesFetched}, Records: ${result.recordsFetched}`);
    }

  } catch (error: any) {
    result.isPartial = true;
    result.errorMessage = error.message;
    result.completionStatus = error instanceof MetaRateLimitError
      ? 'rate_limit_exhausted'
      : error?.name === 'AbortError' || /timeout|aborted/i.test(error?.message || '')
        ? 'timeout'
        : 'api_error';
    console.error(`fetchMetaGraphPaginated partial failure: ${error.message}`);
  }

  return result;
}
