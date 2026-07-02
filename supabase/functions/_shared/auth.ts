import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type VerifiedJwtPayload = {
  sub?: unknown;
  email?: unknown;
  role?: unknown;
  is_anonymous?: unknown;
};

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message)
    this.status = status;
  }
}

function decodeVerifiedJwtPayload(token: string): VerifiedJwtPayload {
  const [, payloadSegment] = token.split('.')
  if (!payloadSegment) throw new HttpError('Unauthorized', 401)

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    const json = atob(padded)
    return JSON.parse(json)
  } catch {
    throw new HttpError('Unauthorized', 401)
  }
}

function userFromVerifiedGatewayJwt(token: string) {
  const payload = decodeVerifiedJwtPayload(token)
  const userId = typeof payload.sub === 'string' ? payload.sub : ''
  const isAnonymous = payload.is_anonymous === true || payload.is_anonymous === 'true'
  if (!userId || isAnonymous) throw new HttpError('Unauthorized', 401)

  return {
    id: userId,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    role: typeof payload.role === 'string' ? payload.role : undefined,
    is_anonymous: false,
  }
}

export async function requireAuthenticatedUser(req: Request) {
  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw new HttpError('Unauthorized', 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new HttpError('Supabase server configuration is incomplete', 500)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const token = authorization.slice('Bearer '.length)
  const shouldVerifyRemotely = Deno.env.get('CAMPLY_VERIFY_AUTH_REMOTELY') === 'true'
  const user = shouldVerifyRemotely
    ? (await userClient.auth.getUser(token)).data.user
    : userFromVerifiedGatewayJwt(token)

  if (!user || user.is_anonymous) throw new HttpError('Unauthorized', 401)

  return {
    user,
    userClient,
    adminClient: createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  }
}

export function errorResponse(error: unknown, headers: Record<string, string>, runId: string | null = null, code: string = 'META_PERSISTENCE_FAILED') {
  const status = error instanceof HttpError ? error.status : 500
  let message = 'An unexpected error occurred';
  
  if (error instanceof HttpError) {
    // Only pass through 400s or non-500s directly if they are explicitly safe.
    // For 500s, mask them to avoid leaking DB or Meta details.
    if (status >= 500) {
      console.error(`[${runId || 'NO_RUN_ID'}] Masked 500 Error:`, error.message);
      message = 'Não foi possível concluir a sincronização.';
    } else {
      message = error.message;
    }
  } else {
    console.error(`[${runId || 'NO_RUN_ID'}] Unhandled Edge Function error:`, error);
    message = 'Não foi possível concluir a sincronização.';
  }

  return new Response(JSON.stringify({
    success: false,
    status: 'failed',
    runId: runId,
    error: {
      code,
      message,
    }
  }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}
