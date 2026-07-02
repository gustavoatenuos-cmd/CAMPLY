import { supabase } from './supabase';

type FunctionEnvelope = {
  error?: string;
  isError?: boolean;
  message?: string;
};

type FunctionErrorWithContext = Error & {
  context?: Response;
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

async function functionErrorMessage(error: unknown): Promise<string | null> {
  const response = (error as FunctionErrorWithContext | undefined)?.context;
  if (!response) return null;
  try {
    const payload = await (typeof response.clone === 'function' ? response.clone() : response).json();
    const message = envelopeMessage(payload);
    if (message) return message;
  } catch {
    try {
      const text = await (typeof response.clone === 'function' ? response.clone() : response).text();
      if (text.trim()) return text.trim();
    } catch {
      return null;
    }
  }
  return null;
}

export async function invokeFunction<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  if (!supabase) {
    throw new Error('Supabase não está configurado.');
  }

  const { data, error } = await supabase.functions.invoke<T & FunctionEnvelope>(name, body === undefined ? undefined : { body });

  if (error) {
    const detailedMessage = await functionErrorMessage(error);
    throw new Error(detailedMessage || error.message || `Falha ao executar ${name}.`);
  }
  if (!data) {
    throw new Error(`A função ${name} não retornou dados.`);
  }
  if (data.isError || data.error) {
    throw new Error(envelopeMessage(data) || `Falha ao executar ${name}.`);
  }

  return data as T;
}
