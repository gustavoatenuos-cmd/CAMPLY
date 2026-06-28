export interface SupabaseMutationResult {
  error?: { message?: string; code?: string } | null;
}

export interface PersistenceFailure {
  operation: string;
  message: string;
  adsetId?: string;
}

export class PersistenceError extends Error {
  constructor(
    public operation: string,
    message: string,
    public adsetId?: string
  ) {
    super(`${operation}: ${message}`);
  }
}

export async function requirePersistence(
  mutation: PromiseLike<SupabaseMutationResult>,
  operation: string,
  adsetId?: string
): Promise<void> {
  const { error } = await mutation;
  if (error) {
    throw new PersistenceError(operation, error.message || error.code || 'Unknown persistence error', adsetId);
  }
}

export async function capturePersistenceFailure(
  mutation: PromiseLike<SupabaseMutationResult>,
  operation: string,
  failures: PersistenceFailure[],
  adsetId?: string
): Promise<boolean> {
  try {
    await requirePersistence(mutation, operation, adsetId);
    return true;
  } catch (error) {
    const persistenceError = error instanceof PersistenceError
      ? error
      : new PersistenceError(operation, error instanceof Error ? error.message : 'Unknown error', adsetId);
    failures.push({
      operation: persistenceError.operation,
      message: persistenceError.message,
      adsetId: persistenceError.adsetId,
    });
    return false;
  }
}

export async function markSyncRunFailed(
  supabaseClient: {
    from(table: string): {
      update(values: Record<string, unknown>): {
        eq(column: string, value: string): PromiseLike<SupabaseMutationResult>;
      };
    };
  },
  usedRunId: string,
  errorMessage: string
): Promise<void> {
  await requirePersistence(
    supabaseClient
      .from('meta_sync_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: errorMessage,
        metadata: { error_message: errorMessage },
      })
      .eq('id', usedRunId),
    'update failed meta_sync_runs'
  );
}
