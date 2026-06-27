import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export class HttpError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
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
  const { data, error } = await userClient.auth.getUser(token)

  if (error || !data.user || data.user.is_anonymous) {
    throw new HttpError('Unauthorized', 401)
  }

  return {
    user: data.user,
    userClient,
    adminClient: createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  }
}

export function errorResponse(error: unknown, headers: Record<string, string>) {
  const status = error instanceof HttpError ? error.status : 500
  const message = error instanceof HttpError ? error.message : 'Unexpected server error'

  if (!(error instanceof HttpError)) {
    console.error('Unhandled Edge Function error', error)
  }

  return new Response(JSON.stringify({ error: message, isError: true }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}
