import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import { errorResponse, HttpError, requireAuthenticatedUser } from '../_shared/auth.ts'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

type ClaudeProxyMode = 'operational_summary' | 'chat_command';

const MODE_CONFIG: Record<ClaudeProxyMode, {
  system: string;
  maxInputLength: number;
  maxOutputTokens: number;
}> = {
  operational_summary: {
    maxInputLength: 20_000,
    maxOutputTokens: 768,
    system: `Você é o agente operacional inteligente do CRM Camply.
Seu papel é analisar alertas e dados operacionais já verificados pelo sistema e produzir um resumo executivo claro e acionável.

REGRAS:
- Seja direto e objetivo, como um briefing militar.
- Use linguagem profissional mas acessível.
- Priorize os itens mais urgentes primeiro.
- Sugira ações concretas e específicas.
- Nunca invente dados que não estejam no contexto.
- Nunca exponha tokens, segredos, chaves, dados de billing ou detalhes internos de infraestrutura.
- Responda sempre em português brasileiro.
- Mantenha o resumo entre 2-4 frases curtas.
- Se não houver alertas, diga que está tudo operacional.

FORMATO DE RESPOSTA (JSON):
{
  "summary_title": "Título curto do resumo",
  "summary_text": "Texto do resumo executivo em 2-4 frases",
  "urgency_level": "critical|high|medium|low",
  "recommended_actions": ["ação 1", "ação 2"]
}`,
  },
  chat_command: {
    maxInputLength: 16_000,
    maxOutputTokens: 1200,
    system: `Você é o assistente virtual do CRM Camply.
Sua missão é interpretar a solicitação do usuário e transformá-la em uma ação estruturada no sistema usando apenas o contexto fornecido na mensagem do usuário.

REGRAS:
1. Retorne sempre um JSON válido, sem markdown antes ou depois.
2. Formato esperado:
{
  "type": "create_client" | "create_campaign" | "create_task" | "create_project" | "none",
  "payload": { ...dados necessários para a ação... },
  "reply_text": "Mensagem curta em português confirmando o que foi feito ou pedindo mais detalhes."
}
3. Se não entender ou se faltar informação crítica, use type: "none" e pergunte amigavelmente.
4. Para "create_campaign", exija pelo menos o nome e tente inferir o cliente pelo contexto fornecido. Se não souber o cliente, pergunte.
5. Nunca execute alteração externa, nunca solicite ou revele tokens/segredos e nunca invente IDs que não estejam no contexto.
6. Seja prestativo e responda em português brasileiro.`,
  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    await requireAuthenticatedUser(req)

    const { mode, userMessage, maxTokens = 1024 } = await req.json() as {
      mode?: unknown;
      userMessage?: unknown;
      maxTokens?: unknown;
    };
    if (mode !== 'operational_summary' && mode !== 'chat_command') {
      throw new HttpError('Invalid Claude proxy mode', 400)
    }
    if (typeof userMessage !== 'string' || !userMessage.trim()) {
      throw new HttpError('Invalid Claude request payload', 400)
    }
    const config = MODE_CONFIG[mode];
    if (userMessage.length > config.maxInputLength) {
      throw new HttpError('Claude request payload is too large', 413)
    }
    const safeMaxTokens = Math.min(Math.max(Number(maxTokens) || 1024, 64), config.maxOutputTokens)

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new HttpError('Anthropic API Key is not configured on the server', 500);
    }

    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: safeMaxTokens,
        system: config.system,
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
