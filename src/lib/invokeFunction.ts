import { supabase } from './supabase';

type FunctionEnvelope = {
  error?: string;
  isError?: boolean;
};

export async function invokeFunction<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  if (!supabase) {
    throw new Error('Supabase não está configurado.');
  }

  const { data, error } = await supabase.functions.invoke<T & FunctionEnvelope>(name, body === undefined ? undefined : { body });

  if (error) {
    throw new Error(error.message || `Falha ao executar ${name}.`);
  }
  if (!data) {
    throw new Error(`A função ${name} não retornou dados.`);
  }
  if (data.isError || data.error) {
    throw new Error(data.error || `Falha ao executar ${name}.`);
  }

  return data as T;
}
