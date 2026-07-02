import {
  getSupabaseAccessToken,
  getSupabaseFunctionUrl,
  getSupabasePublishableKey,
  isSupabaseConfigured,
} from './supabase';
import { OperationTimedOutError } from './withTimeout';

type FunctionEnvelope = {
  error?: string;
  isError?: boolean;
  message?: string;
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
    throw new Error(envelopeMessage(data) || `Falha ao executar ${name}.`);
  }
  if (!data) {
    throw new Error(`A função ${name} não retornou dados.`);
  }
  if (data.isError || data.error) {
    throw new Error(envelopeMessage(data) || `Falha ao executar ${name}.`);
  }

  return data as T;
}
