import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import postgres from 'https://esm.sh/postgres@3.4.5'
import { corsHeaders } from '../_shared/cors.ts'
import { encryptToken } from '../_shared/crypto.ts'
import { META_BASE_URL } from '../_shared/meta-api.ts'
import { errorResponse, HttpError } from '../_shared/auth.ts'

interface MetaOAuthStateData {
  user_id: string;
  redirect_uri: string;
  scopes: string[] | null;
}

interface MetaOAuthProfileData {
  id: string;
  name?: string;
}

type DatabaseFailure = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

type SupabaseAdminClient = ReturnType<typeof createClient>

function isMetaOAuthStateData(value: unknown): value is MetaOAuthStateData {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.user_id === 'string' &&
    typeof state.redirect_uri === 'string' &&
    (state.scopes === null || (Array.isArray(state.scopes) && state.scopes.every((scope) => typeof scope === 'string')))
  );
}

function safeText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function metaErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const error = (payload as Record<string, unknown>).error
  if (!error || typeof error !== 'object') return fallback
  const record = error as Record<string, unknown>
  const message = safeText(record.error_user_msg, safeText(record.message, fallback))
  const code = typeof record.code === 'number' || typeof record.code === 'string' ? ` Código Meta: ${record.code}.` : ''
  return `${message}${code}`
}

function sanitizeCallbackErrorMessage(message: string): string {
  return safeText(message, 'erro não informado')
    .replace(/(access_token=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(client_secret=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(fb_exchange_token=)[^&\s]+/gi, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{80,}/g, '[redacted]')
    .slice(0, 500)
}

function callbackSafeMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message
  if (error instanceof Error) {
    if (/APP_BASE_URL/i.test(error.message)) return 'O retorno para o CAMPLY não está configurado.'
    if (/META_TOKEN_ENCRYPTION_KEY/i.test(error.message)) return 'A criptografia do token Meta não está configurada.'
    if (/Meta credentials/i.test(error.message)) return 'As credenciais do aplicativo Meta não estão configuradas.'
    return `Falha técnica no callback Meta: ${sanitizeCallbackErrorMessage(error.message)}`
  }
  return `Falha técnica no callback Meta: ${sanitizeCallbackErrorMessage(String(error))}`
}

function databaseErrorMessage(stage: string, error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined): HttpError {
  const message = safeText(error?.message, 'erro não informado')
  const code = safeText(error?.code, '')
  const suffix = code ? ` Código Supabase: ${code}.` : ''
  console.error(`Meta OAuth database ${stage} failed`, {
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
  })
  return new HttpError(`Não foi possível salvar a integração Meta no banco (${stage}): ${message}.${suffix}`, 500)
}

function isPostgrestPoolTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message.toLowerCase() : ''
  return code === 'PGRST003'
    || message.includes('connection pool')
    || message.includes('timed out acquiring connection')
}

async function persistIntegrationViaPostgrest(
  supabaseClient: SupabaseAdminClient,
  stateData: MetaOAuthStateData,
  meData: MetaOAuthProfileData,
  encryptedToken: string,
  tokenExpiresAt: string | null,
): Promise<void> {
  // Do not use maybeSingle(): existing legacy projects may already have
  // duplicated rows for the same Meta user, and PostgREST treats that as an
  // error. Pick the newest row and repair the active token there.
  const { data: existingRows, error: searchError } = await supabaseClient
    .from('meta_integrations')
    .select('id')
    .eq('user_id', stateData.user_id)
    .eq('provider', 'meta')
    .eq('meta_user_id', meData.id)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(1);

  if (searchError) throw searchError

  const existingInt = Array.isArray(existingRows) ? existingRows[0] : null

  if (existingInt) {
    const { error: updateError } = await supabaseClient
      .from('meta_integrations')
      .update({
        provider: 'meta',
        access_token_encrypted: encryptedToken,
        meta_user_name: meData.name,
        granted_scopes: stateData.scopes,
        token_expires_at: tokenExpiresAt,
        status: 'active',
        last_validated_at: new Date().toISOString(),
      })
      .eq('id', existingInt.id);

    if (updateError) throw updateError

    // Best-effort cleanup: keep only the selected row active if duplicates
    // exist. This is intentionally non-blocking to avoid breaking OAuth.
    supabaseClient
      .from('meta_integrations')
      .update({ status: 'revoked' })
      .eq('user_id', stateData.user_id)
      .eq('provider', 'meta')
      .eq('meta_user_id', meData.id)
      .neq('id', existingInt.id)
      .then(({ error }) => {
        if (error) console.warn('Duplicate Meta integration cleanup skipped', error.message)
      })
    return
  }

  const { error: insertError } = await supabaseClient
    .from('meta_integrations')
    .insert({
      id: crypto.randomUUID(),
      user_id: stateData.user_id,
      provider: 'meta',
      meta_user_id: meData.id,
      meta_user_name: meData.name,
      access_token_encrypted: encryptedToken,
      token_type: 'bearer',
      granted_scopes: stateData.scopes,
      token_expires_at: tokenExpiresAt,
      status: 'active',
      last_validated_at: new Date().toISOString(),
    });

  if (insertError) throw insertError
}

async function persistIntegrationViaDirectPostgres(
  stateData: MetaOAuthStateData,
  meData: MetaOAuthProfileData,
  encryptedToken: string,
  tokenExpiresAt: string | null,
): Promise<void> {
  const dbUrl = Deno.env.get('CAMPLY_DB_URL') ?? Deno.env.get('SUPABASE_DB_URL')
  if (!dbUrl) {
    throw new HttpError('A conexão direta com o banco não está configurada para fallback direto do OAuth Meta.', 500)
  }

  const sql = postgres(dbUrl, {
    max: 1,
    idle_timeout: 1,
    connect_timeout: 8,
    prepare: false,
  })

  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`meta-oauth:${stateData.user_id}:${meData.id}`}))`
      const rows = await tx<{ id: string }[]>`
        select id
        from public.meta_integrations
        where user_id::text = ${stateData.user_id}
          and provider = 'meta'
          and meta_user_id = ${meData.id}
        order by updated_at desc nulls last, created_at desc nulls last
        limit 1
      `

      const existingId = rows[0]?.id
      if (existingId) {
        await tx`
          update public.meta_integrations
          set provider = 'meta',
              access_token_encrypted = ${encryptedToken},
              meta_user_name = ${meData.name || null},
              granted_scopes = ${stateData.scopes || []}::text[],
              token_expires_at = ${tokenExpiresAt}::timestamptz,
              status = 'active',
              last_validated_at = now(),
              updated_at = now()
          where id = ${existingId}::uuid
        `
        await tx`
          update public.meta_integrations
          set status = 'revoked',
              updated_at = now()
          where user_id::text = ${stateData.user_id}
            and provider = 'meta'
            and meta_user_id = ${meData.id}
            and id <> ${existingId}::uuid
        `
      } else {
        await tx`
          insert into public.meta_integrations (
            id,
            user_id,
            provider,
            meta_user_id,
            meta_user_name,
            access_token_encrypted,
            token_type,
            granted_scopes,
            token_expires_at,
            status,
            last_validated_at,
            created_at,
            updated_at
          ) values (
            ${crypto.randomUUID()}::uuid,
            ${stateData.user_id},
            'meta',
            ${meData.id},
            ${meData.name || null},
            ${encryptedToken},
            'bearer',
            ${stateData.scopes || []}::text[],
            ${tokenExpiresAt}::timestamptz,
            'active',
            now(),
            now(),
            now()
          )
        `
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Meta OAuth direct Postgres persistence failed', { message })
    throw new HttpError(`Não foi possível salvar a integração Meta no banco pelo fallback direto: ${message}`, 500)
  } finally {
    try {
      await sql.end()
    } catch (endError) {
      console.warn('Meta OAuth direct Postgres connection close skipped', {
        message: endError instanceof Error ? endError.message : String(endError),
      })
    }
  }
}

async function persistMetaIntegration(
  supabaseClient: SupabaseAdminClient,
  stateData: MetaOAuthStateData,
  meData: MetaOAuthProfileData,
  encryptedToken: string,
  tokenExpiresAt: string | null,
): Promise<void> {
  try {
    await persistIntegrationViaPostgrest(supabaseClient, stateData, meData, encryptedToken, tokenExpiresAt)
  } catch (error) {
    if (!isPostgrestPoolTimeout(error)) {
      throw databaseErrorMessage('salvar integração via PostgREST', error as DatabaseFailure)
    }
    console.warn('PostgREST pool exhausted while saving Meta OAuth integration; using direct Postgres fallback.', {
      code: (error as DatabaseFailure).code,
      message: (error as DatabaseFailure).message,
    })
    await persistIntegrationViaDirectPostgres(stateData, meData, encryptedToken, tokenExpiresAt)
  }
}

function redirectWithOAuthError(error: unknown): Response | null {
  const appBaseUrl = Deno.env.get('APP_BASE_URL')
  if (!appBaseUrl) return null
  const target = new URL(appBaseUrl)
  target.searchParams.set('meta_sync', 'error')
  target.searchParams.set('meta_error', callbackSafeMessage(error))
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: target.toString(),
    },
  })
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return diff === 0
}

async function verifySignedState(state: string): Promise<MetaOAuthStateData | null> {
  const [payloadSegment, signatureSegment] = state.split('.')
  if (!payloadSegment || !signatureSegment) return null

  const secret = Deno.env.get('META_TOKEN_ENCRYPTION_KEY') || Deno.env.get('META_APP_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret) throw new HttpError('OAuth state signing is not configured', 500)

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const expectedSignature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadSegment)))
  if (!constantTimeEqual(signatureSegment, base64UrlEncode(expectedSignature))) {
    throw new HttpError('Invalid state signature', 400)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadSegment)))
  } catch {
    throw new HttpError('Invalid state payload', 400)
  }

  const expiresAt = typeof payload.exp === 'number' ? payload.exp : 0
  if (!expiresAt || expiresAt < Math.floor(Date.now() / 1000)) {
    throw new HttpError('Expired state parameter', 400)
  }

  const stateData = {
    user_id: payload.user_id,
    redirect_uri: payload.redirect_uri,
    scopes: payload.scopes,
  }
  if (!isMetaOAuthStateData(stateData)) {
    throw new HttpError('Invalid state payload', 400)
  }

  return stateData
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const facebookError = url.searchParams.get('error') || url.searchParams.get('error_reason');
    const facebookDescription = url.searchParams.get('error_description') || url.searchParams.get('error_message');

    if (facebookError) {
      throw new HttpError(`Facebook recusou a autorização: ${safeText(facebookDescription, facebookError)}`, 400)
    }

    if (!code || !state) {
      throw new HttpError('Code or State missing in URL parameters', 400);
    }

    // New authorizations use a signed stateless state so the OAuth start
    // endpoint does not depend on database writes before redirecting to Meta.
    // Legacy authorizations in flight still fall back to the atomic DB state.
    let stateData = await verifySignedState(state);
    if (!stateData) {
      // 1. Hash the incoming state
      const msgUint8 = new TextEncoder().encode(state);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const stateHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      // 2. Consume via Atomic RPC
      const { data: legacyStateData, error: stateError } = await supabaseClient
        .rpc('consume_meta_oauth_state', { p_state_hash: stateHash })
        .single();

      if (stateError || !legacyStateData) {
        console.log('RPC Error:', stateError);
        throw new HttpError('Invalid, expired, or already used state parameter', 400);
      }
      if (!isMetaOAuthStateData(legacyStateData)) {
        throw new HttpError('Invalid state payload returned by OAuth state store', 400);
      }
      stateData = legacyStateData
    }

    // 2. Exchange code for user access token
    const appId = Deno.env.get('META_APP_ID');
    const appSecret = Deno.env.get('META_APP_SECRET');
    
    if (!appId || !appSecret) throw new Error('Meta credentials missing from env');

    const tokenUrl = new URL(`${META_BASE_URL}/oauth/access_token`);
    tokenUrl.searchParams.append('client_id', appId);
    tokenUrl.searchParams.append('redirect_uri', stateData.redirect_uri);
    tokenUrl.searchParams.append('client_secret', appSecret);
    tokenUrl.searchParams.append('code', code);

    const tokenRes = await fetch(tokenUrl.toString());
    let tokenData;
    try { tokenData = await tokenRes.json(); } catch (e) { tokenData = {}; }

    if (!tokenRes.ok) {
      console.error('Token fetch failed', {
        status: tokenRes.status,
        metaError: tokenData?.error?.message,
        metaCode: tokenData?.error?.code,
        metaSubcode: tokenData?.error?.error_subcode,
      });
      throw new HttpError(`Facebook recusou a troca do código de autorização. ${metaErrorMessage(tokenData, 'Verifique o Redirect URI e as permissões do aplicativo Meta.')}`, 400);
    }

    let accessToken = tokenData.access_token;
    if (!accessToken || typeof accessToken !== 'string') {
      throw new HttpError('Facebook não retornou um token de acesso válido.', 400)
    }

    // 3. Exchange short-lived token for long-lived token
    const longTokenUrl = new URL(`${META_BASE_URL}/oauth/access_token`);
    longTokenUrl.searchParams.append('grant_type', 'fb_exchange_token');
    longTokenUrl.searchParams.append('client_id', appId);
    longTokenUrl.searchParams.append('client_secret', appSecret);
    longTokenUrl.searchParams.append('fb_exchange_token', accessToken);

    const longTokenRes = await fetch(longTokenUrl.toString());
    let longTokenData;
    try { longTokenData = await longTokenRes.json(); } catch (e) { longTokenData = {}; }

    if (!longTokenRes.ok) {
      console.error('Long token fetch failed', {
        status: longTokenRes.status,
        metaError: longTokenData?.error?.message,
        metaCode: longTokenData?.error?.code,
        metaSubcode: longTokenData?.error?.error_subcode,
      });
      throw new HttpError(`Facebook recusou o token de longa duração. ${metaErrorMessage(longTokenData, 'Verifique as permissões do aplicativo Meta.')}`, 400);
    }
    
    if (longTokenData.access_token) {
      accessToken = longTokenData.access_token;
    }
    
    const expiresIn = longTokenData.expires_in || tokenData.expires_in;
    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
      : null;

    // 4. Fetch user profile
    const meUrl = new URL(`${META_BASE_URL}/me`);
    meUrl.searchParams.append('access_token', accessToken);
    
    const meRes = await fetch(meUrl.toString());
    let meData;
    try { meData = await meRes.json(); } catch (e) { meData = {}; }

    if (!meRes.ok) {
      console.error('User profile fetch failed', {
        status: meRes.status,
        metaError: meData?.error?.message,
        metaCode: meData?.error?.code,
        metaSubcode: meData?.error?.error_subcode,
      });
      throw new HttpError(`Facebook não liberou o perfil do usuário. ${metaErrorMessage(meData, 'Verifique as permissões do aplicativo Meta.')}`, 400);
    }
    if (!meData.id) throw new HttpError('Facebook não retornou o ID do usuário Meta.', 400)

    // 5. Encrypt token
    const encryptedToken = await encryptToken(accessToken);

    // 6. Save or Update Integration. Prefer Supabase/PostgREST, but bypass its
    // connection pool when it is exhausted (PGRST003) so OAuth can still finish.
    await persistMetaIntegration(supabaseClient, stateData, {
      id: String(meData.id),
      name: typeof meData.name === 'string' ? meData.name : undefined,
    }, encryptedToken, tokenExpiresAt)

    // 7. Redirect back to frontend
    const appBaseUrl = Deno.env.get('APP_BASE_URL');
    if (!appBaseUrl) throw new Error('APP_BASE_URL missing');
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: `${appBaseUrl}?meta_sync=success`
      },
    })

  } catch (error) {
    const redirect = redirectWithOAuthError(error)
    if (redirect) return redirect
    return errorResponse(error, corsHeaders, null, 'META_OAUTH_FAILED');
  }
})
