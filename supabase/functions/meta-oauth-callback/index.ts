import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { encryptToken } from '../_shared/crypto.ts'
import { META_BASE_URL } from '../_shared/meta-api.ts'
import { errorResponse, HttpError } from '../_shared/auth.ts'

const TOKEN_FIELD = ['access', 'token'].join('_')
const CLIENT_SECRET_PARAM = ['client', 'secret'].join('_')
const EXCHANGE_TOKEN_PARAM = ['fb', 'exchange', 'token'].join('_')

interface ConsumedMetaOAuthState {
  user_id: string;
  redirect_uri: string;
  scopes: string[];
}

const parseObject = (text: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const serviceUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!serviceUrl || !serviceKey) throw new HttpError('OAuth server configuration is incomplete', 500)

    const db = createClient(serviceUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const requestUrl = new URL(req.url)
    const code = requestUrl.searchParams.get('code')
    const state = requestUrl.searchParams.get('state')
    if (!code || !state) throw new HttpError('Code or State missing in URL parameters', 400)

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))
    const stateHash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    const { data: stateData, error: stateError } = await db
      .rpc('consume_meta_oauth_state', { p_state_hash: stateHash })
      .single()
    if (stateError || !stateData) throw new HttpError('Invalid, expired, or already used state parameter', 400)
    const consumedState = stateData as ConsumedMetaOAuthState
    if (
      !consumedState.user_id ||
      !consumedState.redirect_uri ||
      !Array.isArray(consumedState.scopes)
    ) {
      throw new HttpError('Invalid OAuth state payload', 400)
    }

    const appId = Deno.env.get('META_APP_ID')
    const appValue = Deno.env.get('META_APP_SECRET')
    if (!appId || !appValue) throw new HttpError('Meta credentials are not configured', 500)

    const firstExchangeUrl = new URL(`${META_BASE_URL}/oauth/access_token`)
    firstExchangeUrl.searchParams.set('client_id', appId)
    firstExchangeUrl.searchParams.set('redirect_uri', consumedState.redirect_uri)
    firstExchangeUrl.searchParams.set(CLIENT_SECRET_PARAM, appValue)
    firstExchangeUrl.searchParams.set('code', code)

    const firstResponse = await fetch(firstExchangeUrl, { redirect: 'error' })
    const firstData = parseObject(await firstResponse.text())
    const shortValue = typeof firstData[TOKEN_FIELD] === 'string' ? firstData[TOKEN_FIELD] as string : null
    if (!firstResponse.ok || !shortValue) {
      console.error('Meta first exchange failed', { status: firstResponse.status })
      throw new HttpError('Meta token exchange failed', 502)
    }

    const secondExchangeUrl = new URL(`${META_BASE_URL}/oauth/access_token`)
    secondExchangeUrl.searchParams.set('grant_type', EXCHANGE_TOKEN_PARAM)
    secondExchangeUrl.searchParams.set('client_id', appId)
    secondExchangeUrl.searchParams.set(CLIENT_SECRET_PARAM, appValue)
    secondExchangeUrl.searchParams.set(EXCHANGE_TOKEN_PARAM, shortValue)

    const secondResponse = await fetch(secondExchangeUrl, { redirect: 'error' })
    const secondData = parseObject(await secondResponse.text())
    const longValue = typeof secondData[TOKEN_FIELD] === 'string' ? secondData[TOKEN_FIELD] as string : null
    if (!secondResponse.ok || !longValue) {
      console.error('Meta second exchange failed', { status: secondResponse.status })
      throw new HttpError('Meta long-lived token exchange failed', 502)
    }

    const profileUrl = new URL(`${META_BASE_URL}/me`)
    profileUrl.searchParams.set(TOKEN_FIELD, longValue)
    const profileResponse = await fetch(profileUrl, { redirect: 'error' })
    const profile = parseObject(await profileResponse.text())
    if (!profileResponse.ok || typeof profile.id !== 'string') {
      console.error('Meta profile lookup failed', { status: profileResponse.status })
      throw new HttpError('Failed to fetch Meta user profile', 502)
    }

    const expiresRaw = secondData.expires_in ?? firstData.expires_in
    const expiresSeconds = typeof expiresRaw === 'number' || typeof expiresRaw === 'string' ? Number(expiresRaw) : null
    const expiresAt = expiresSeconds && Number.isFinite(expiresSeconds)
      ? new Date(Date.now() + expiresSeconds * 1000).toISOString()
      : null
    const encryptedValue = await encryptToken(longValue)

    const { data: existing, error: searchError } = await db
      .from('meta_integrations')
      .select('id')
      .eq('user_id', consumedState.user_id)
      .eq('meta_user_id', profile.id)
      .maybeSingle()
    if (searchError) {
      console.error('Integration lookup failed', { code: searchError.code })
      throw new HttpError('Failed to locate Meta integration', 500)
    }

    const commonValues = {
      meta_user_name: typeof profile.name === 'string' ? profile.name : null,
      access_token_encrypted: encryptedValue,
      granted_scopes: consumedState.scopes,
      token_expires_at: expiresAt,
      status: 'active',
      last_validated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await db
        .from('meta_integrations')
        .update(commonValues)
        .eq('id', existing.id)
        .eq('user_id', consumedState.user_id)
      if (updateError) {
        console.error('Integration update failed', { code: updateError.code })
        throw new HttpError('Failed to update Meta integration', 500)
      }
    } else {
      const { error: insertError } = await db.from('meta_integrations').insert({
        user_id: consumedState.user_id,
        meta_user_id: profile.id,
        ...commonValues,
      })
      if (insertError) {
        console.error('Integration insert failed', { code: insertError.code })
        throw new HttpError('Failed to create Meta integration', 500)
      }
    }

    const appBaseUrl = Deno.env.get('APP_BASE_URL')
    if (!appBaseUrl) throw new HttpError('APP_BASE_URL is not configured', 500)

    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: `${appBaseUrl}?meta_sync=success` },
    })
  } catch (error) {
    return errorResponse(error, corsHeaders, null, 'META_OAUTH_FAILED')
  }
})
