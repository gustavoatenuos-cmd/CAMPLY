import {
  getSupabaseAccessToken,
  getSupabaseFunctionUrl,
  getSupabasePublishableKey,
  isSupabaseConfigured,
} from './supabase';
import { OperationTimedOutError } from './withTimeout';

type FunctionEnvelope = {
  error?: string | {
    code?: unknown;
    message?: unknown;
  };
  isError?: boolean;
  message?: string;
  runId?: unknown;
};

function envelopeMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  const message = record.message;
  return typeof message === 'string' && message.trim() ? message : null;
}

function envelopeErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== 'object') return null;
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' && code.trim() ? code : null;
}

function envelopeRunId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const runId = (payload as Record<string, unknown>).runId;
  return typeof runId === 'string' && runId.trim() ? runId : null;
}

export class InvokeError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string | null = null,
    public runId: string | null = null
  ) {
    super(message);
    this.name = 'InvokeError';
  }
}

export async function invokeFunction<T>(
  name: string,
  body?: Record<string, unknown>,
  timeoutMs = 60_000
): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase não está configurado.');
  }

  const url = getSupabaseFunctionUrl(name);
  const publishableKey = getSupabasePublishableKey();
  const accessToken = getSupabaseAccessToken();
  if (!url || !publishableKey) throw new Error('Supabase não está configurado.');
  if (!accessToken) throw new Error('Sua sessão ainda não foi carregada. Recarregue a página e tente novamente.');

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  let data: (T & FunctionEnvelope) | null = null;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new OperationTimedOutError(`A função ${name} demorou mais que o esperado.`);
    }
    if (error instanceof Error && error.message.includes('Failed to fetch')) {
      throw new Error(`Falha de rede/CORS ao acessar a função '${name}'. Isso ocorre se a função não estiver publicada no Supabase ou se o servidor sofreu Timeout/OOM (502/504) derrubando os cabeçalhos CORS.`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new InvokeError(
      envelopeMessage(data) || `Falha ao executar ${name}.`,
      response.status,
      envelopeErrorCode(data),
      envelopeRunId(data)
    );
  }
  if (!data) {
    throw new Error(`A função ${name} não retornou dados.`);
  }
  if (data.isError || data.error) {
    throw new InvokeError(
      envelopeMessage(data) || `Falha ao executar ${name}.`,
      response.status,
      envelopeErrorCode(data),
      envelopeRunId(data)
    );
  }

  return data as T;
}
