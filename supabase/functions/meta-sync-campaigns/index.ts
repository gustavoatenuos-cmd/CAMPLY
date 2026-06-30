import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  return new Response(JSON.stringify({
    success: false,
    status: 'failed',
    error: {
      code: 'LEGACY_ENDPOINT_DISABLED',
      message: 'Endpoint legado desativado. Use meta-sync-ads com metaAssetId.',
    },
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 410,
  })
})
