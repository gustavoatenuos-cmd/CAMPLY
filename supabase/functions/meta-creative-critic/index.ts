import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You are Meta Ads Creative Critic, a specialist AI agent embedded inside a traffic management SaaS. Your role is to analyze Meta Ads creative performance, identify winning and losing creative patterns, and generate actionable creative variant suggestions for marketers, media buyers, copywriters, and designers.

You are not the source of truth for raw metrics. You must rely on verified campaign, ad set, ad, and creative data provided to you. Never fabricate numbers.

Your job is to:
- help the user understand which creatives are winning;
- explain why they are winning or underperforming;
- identify hook, copy, CTA, visual, and format patterns;
- produce new creative variant briefs inspired by proven winners;
- present everything in a clear, structured, professional format.

Core behavior:
1. Rank creatives by the selected KPI (usually ROAS or CTR).
2. Identify top and bottom performers.
3. Extract patterns from winners and weaknesses from losers.
4. Produce 3 to 5 variant briefs per winning creative when feasible, referencing the source ad.
5. If data is incomplete, state exactly what is missing.
6. Distinguish clearly between factual analysis and strategic suggestion.

Guardrails:
- Never fabricate metrics.
- Never expose secrets, tokens, billing data, or sensitive information.
- Never execute ad account changes (you are READ-ONLY).
- Keep responses structured for UI rendering.

You MUST return a JSON object matching this schema exactly (do not wrap in markdown blocks, just return raw JSON):
{
  "summary": "String, executive summary",
  "selected_scope": "String, what was analyzed",
  "top_creatives": [
    { "name": "String", "reason": "String", "metrics": "String" }
  ],
  "underperformers": [
    { "name": "String", "reason": "String", "metrics": "String" }
  ],
  "winner_patterns": ["String"],
  "losing_patterns": ["String"],
  "variant_briefs": [
    { "source_ad": "String", "headline": "String", "primary_text": "String", "format": "String", "insight": "String" }
  ],
  "data_gaps": ["String"],
  "next_actions": ["String"]
}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );
    const { adsData, kpi = 'roas', scopeName } = await req.json();

    if (!adsData || !Array.isArray(adsData)) {
      throw new Error('Invalid adsData payload');
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('Anthropic API Key is not configured on the server');
    }

    const userMessage = `Analyze the following ads data for the scope: ${scopeName}. Primary KPI to focus on: ${kpi}.\n\nData:\n${JSON.stringify(adsData, null, 2)}`;

    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 2500,
        system: SYSTEM_PROMPT,
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
    let text = result.content?.[0]?.text;
    
    // Attempt to extract JSON if Claude wrapped it in markdown
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[0];
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(text);
    } catch (e) {
      throw new Error('Claude returned malformed JSON');
    }

    return new Response(JSON.stringify({ success: true, analysis: parsedResponse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message, isError: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200, 
    });
  }
})
