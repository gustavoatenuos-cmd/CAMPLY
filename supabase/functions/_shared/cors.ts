export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_BASE_URL') || 'http://localhost:3000',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
