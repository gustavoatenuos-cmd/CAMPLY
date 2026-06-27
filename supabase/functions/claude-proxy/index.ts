import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { errorResponse, requireAuthenticatedUser } from '../_shared/auth.ts'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    await requireAuthenticatedUser(req)

    const { systemPrompt, userMessage, maxTokens = 1024 } = await req.json();
    if (typeof systemPrompt !== 'string' || typeof userMessage !== 'string') {
      throw new Error('Invalid Claude request payload')
    }
    if (systemPrompt.length > 12_000 || userMessage.length > 60_000) {
      throw new Error('Claude request payload is too large')
    }
    const safeMaxTokens = Math.min(Math.max(Number(maxTokens) || 1024, 64), 2048)

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('Anthropic API Key is not configured on the server');
    }

    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: safeMaxTokens,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userMessage,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API Error: ${errorText}`);
    }

    const result = await response.json();
    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return errorResponse(error, corsHeaders)
  }
})
