import { describe, expect, it } from 'vitest';
import { InvokeError } from '../invokeFunction';
import {
  applyAccountOutcome,
  buildBulkSyncSummaryMessage,
  classifySyncOutcome,
  extractSyncErrorMessage,
  initializeBulkSyncProgress,
  isBulkSyncAllFailed,
  outcomeFromThrownError,
  type BulkSyncAccountInput,
  type BulkSyncProgress,
} from './bulkSyncDiagnostics';

function account(overrides: Partial<BulkSyncAccountInput> = {}): BulkSyncAccountInput {
  return {
    clientId: 'client-1',
    clientName: 'Cliente 1',
    clientMetaAssetId: 'link-1',
    accountName: 'Conta 1',
    adAccountId: 'act_1',
    ...overrides,
  };
}

describe('classifySyncOutcome', () => {
  it('maps a success result to success', () => {
    const outcome = classifySyncOutcome({ success: true, status: 'success', runId: 'run-1', message: 'ok' });
    expect(outcome.status).toBe('success');
    expect(outcome.runId).toBe('run-1');
  });

  it('maps a partial result to partial, never to failed', () => {
    const outcome = classifySyncOutcome({ success: true, status: 'partial', runId: 'run-2', message: 'Alguns adsets falharam' });
    expect(outcome.status).toBe('partial');
    expect(outcome.error).toBeUndefined();
  });

  it('maps a running/already-in-progress result to already_running, not to failed', () => {
    const outcome = classifySyncOutcome({ success: true, status: 'running', runId: null, message: 'Sincronização já em andamento' });
    expect(outcome.status).toBe('already_running');
    expect(outcome.error).toBeUndefined();
  });

  it('maps a failed result to failed and preserves the real message', () => {
    const outcome = classifySyncOutcome({ success: false, status: 'failed', runId: 'run-3', message: 'Token Meta expirado' });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('Token Meta expirado');
    expect(outcome.message).toBe('Token Meta expirado');
  });

  it('falls back to a generic message when a failed result carries none', () => {
    const outcome = classifySyncOutcome({ success: false, status: 'failed', runId: null });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('Falha desconhecida na sincronização.');
  });
});

describe('extractSyncErrorMessage / outcomeFromThrownError', () => {
  it('surfaces the InvokeError message and HTTP status when the message is empty', () => {
    expect(extractSyncErrorMessage(new InvokeError('Rate limit excedido', 429))).toBe('Rate limit excedido');
    expect(extractSyncErrorMessage(new InvokeError('', 500))).toBe('Falha na sincronização (HTTP 500).');
  });

  it('preserves safe function code and runId from thrown InvokeError', () => {
    const outcome = outcomeFromThrownError(new InvokeError('Falha rastreável', 500, 'META_PERSISTENCE_FAILED', 'run-123'));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('Falha rastreável');
    expect(outcome.errorCode).toBe('META_PERSISTENCE_FAILED');
    expect(outcome.runId).toBe('run-123');
  });

  it('surfaces a plain Error message', () => {
    expect(extractSyncErrorMessage(new Error('Timeout de rede'))).toBe('Timeout de rede');
  });

  it('falls back to a generic message for non-Error throws', () => {
    expect(extractSyncErrorMessage('algo caiu')).toBe('Falha desconhecida na sincronização.');
    expect(extractSyncErrorMessage(undefined)).toBe('Falha desconhecida na sincronização.');
  });

  it('never swallows a thrown error - it always becomes a failed outcome carrying the real message', () => {
    const outcome = outcomeFromThrownError(new Error('Conta sem permissão de leitura'));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('Conta sem permissão de leitura');
  });
});

describe('initializeBulkSyncProgress / applyAccountOutcome', () => {
  it('starts every account as pending', () => {
    const progress = initializeBulkSyncProgress([account({ clientMetaAssetId: 'a' }), account({ clientMetaAssetId: 'b' })]);
    expect(progress.total).toBe(2);
    expect(progress.results.every((result) => result.status === 'pending')).toBe(true);
    expect(progress.success + progress.partial + progress.failed).toBe(0);
  });

  it('increments completed/success and never touches failed for a success outcome', () => {
    const progress = initializeBulkSyncProgress([account()]);
    const next = applyAccountOutcome(progress, 'link-1', { status: 'success', runId: 'run-1' });
    expect(next.completed).toBe(1);
    expect(next.success).toBe(1);
    expect(next.failed).toBe(0);
    expect(next.results[0].status).toBe('success');
  });

  it('counts a partial outcome separately from failed', () => {
    const progress = initializeBulkSyncProgress([account()]);
    const next = applyAccountOutcome(progress, 'link-1', { status: 'partial', message: 'parcial' });
    expect(next.partial).toBe(1);
    expect(next.failed).toBe(0);
  });

  it('counts already_running towards completed but not success/partial/failed', () => {
    const progress = initializeBulkSyncProgress([account()]);
    const next = applyAccountOutcome(progress, 'link-1', { status: 'already_running', message: 'Sincronização já em andamento' });
    expect(next.completed).toBe(1);
    expect(next.success + next.partial + next.failed).toBe(0);
  });

  it('replaces the previous contribution instead of double-counting on retry', () => {
    let progress = initializeBulkSyncProgress([account()]);
    progress = applyAccountOutcome(progress, 'link-1', { status: 'failed', error: 'Token expirado' });
    expect(progress.failed).toBe(1);

    const retried = applyAccountOutcome(progress, 'link-1', { status: 'success', runId: 'run-retry' }, 'failed');
    expect(retried.failed).toBe(0);
    expect(retried.success).toBe(1);
    expect(retried.completed).toBe(1);
    expect(retried.results[0].status).toBe('success');
  });

  it('does not double-count when a retry goes through an intermediate running state (UI spinner) before resolving', () => {
    let progress = initializeBulkSyncProgress([account()]);
    progress = applyAccountOutcome(progress, 'link-1', { status: 'failed', error: 'Token expirado' });
    expect(progress.failed).toBe(1);
    expect(progress.completed).toBe(1);

    // Retry flips the row to 'running' first (for the spinner), decrementing the old failed count right away...
    progress = applyAccountOutcome(progress, 'link-1', { status: 'running' }, 'failed');
    expect(progress.failed).toBe(0);
    expect(progress.completed).toBe(0);

    // ...then the resolved outcome adds its own contribution exactly once.
    progress = applyAccountOutcome(progress, 'link-1', { status: 'success', runId: 'run-retry' }, 'running');
    expect(progress.failed).toBe(0);
    expect(progress.success).toBe(1);
    expect(progress.completed).toBe(1);
  });
});

describe('buildBulkSyncSummaryMessage', () => {
  function progressWith(statuses: Array<BulkSyncProgress['results'][number]>): BulkSyncProgress {
    let progress = initializeBulkSyncProgress(statuses.map((s) => ({
      clientId: s.clientId,
      clientName: s.clientName,
      clientMetaAssetId: s.clientMetaAssetId,
      accountName: s.accountName,
      adAccountId: s.adAccountId,
    })));
    for (const result of statuses) {
      progress = applyAccountOutcome(progress, result.clientMetaAssetId, result);
    }
    return { ...progress, running: false };
  }

  it('reports the correct counts when every account succeeds', () => {
    const progress = progressWith([
      { ...account({ clientMetaAssetId: 'a' }), status: 'success' },
      { ...account({ clientMetaAssetId: 'b' }), status: 'success' },
    ]);
    expect(buildBulkSyncSummaryMessage(progress)).toBe('Sincronização concluída: 2 sucesso.');
  });

  it('reports mixed success/partial/already_running/failed counts', () => {
    const progress = progressWith([
      { ...account({ clientMetaAssetId: 'a' }), status: 'success' },
      { ...account({ clientMetaAssetId: 'b' }), status: 'partial', message: 'parcial' },
      { ...account({ clientMetaAssetId: 'c' }), status: 'already_running', message: 'Sincronização já em andamento' },
      { ...account({ clientMetaAssetId: 'd' }), status: 'failed', error: 'Token expirado' },
    ]);
    expect(buildBulkSyncSummaryMessage(progress)).toBe(
      'Sincronização concluída: 1 sucesso, 1 parcial, 1 em andamento, 1 falha.'
    );
  });

  it('shows the "nothing synced" alert when every account fails', () => {
    const progress = progressWith([
      { ...account({ clientMetaAssetId: 'a' }), status: 'failed', error: 'Erro A' },
      { ...account({ clientMetaAssetId: 'b' }), status: 'failed', error: 'Erro B' },
    ]);
    const message = buildBulkSyncSummaryMessage(progress);
    expect(message).toContain('Nenhuma conta foi sincronizada. Veja os erros abaixo.');
    expect(message).not.toContain('mesmo motivo');
  });

  it('highlights when all failures share the exact same reason', () => {
    const progress = progressWith([
      { ...account({ clientMetaAssetId: 'a' }), status: 'failed', error: 'Token Meta expirado' },
      { ...account({ clientMetaAssetId: 'b' }), status: 'failed', error: 'Token Meta expirado' },
      { ...account({ clientMetaAssetId: 'c' }), status: 'failed', error: 'Token Meta expirado' },
    ]);
    expect(buildBulkSyncSummaryMessage(progress)).toBe(
      'Nenhuma conta foi sincronizada. Veja os erros abaixo. Todas as contas falharam pelo mesmo motivo: Token Meta expirado'
    );
  });
});

describe('isBulkSyncAllFailed', () => {
  it('is false while the batch is still running, even if everyone processed so far has failed', () => {
    let progress = initializeBulkSyncProgress([account({ clientMetaAssetId: 'a' }), account({ clientMetaAssetId: 'b' })]);
    progress = applyAccountOutcome(progress, 'a', { status: 'failed', error: 'Erro A' });
    // `running` is still true (the batch hasn't finished) and account 'b' hasn't been processed yet.
    expect(isBulkSyncAllFailed(progress)).toBe(false);
  });

  it('is false when only some of the finished accounts failed and others are still pending', () => {
    let progress = initializeBulkSyncProgress([account({ clientMetaAssetId: 'a' }), account({ clientMetaAssetId: 'b' })]);
    progress = applyAccountOutcome(progress, 'a', { status: 'failed', error: 'Erro A' });
    progress = { ...progress, running: false }; // simulates a caller checking mid-batch by mistake
    expect(isBulkSyncAllFailed(progress)).toBe(false);
  });

  it('is true once the whole batch finished and every account failed', () => {
    let progress = initializeBulkSyncProgress([account({ clientMetaAssetId: 'a' }), account({ clientMetaAssetId: 'b' })]);
    progress = applyAccountOutcome(progress, 'a', { status: 'failed', error: 'Erro A' });
    progress = applyAccountOutcome(progress, 'b', { status: 'failed', error: 'Erro B' });
    progress = { ...progress, running: false };
    expect(isBulkSyncAllFailed(progress)).toBe(true);
  });
});
