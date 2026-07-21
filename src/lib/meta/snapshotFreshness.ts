// Camply is a decision hub built on synchronized, traceable, auditable data —
// not a live window into Meta. Every campaign/adset/ad status the UI shows comes
// from the last saved sync snapshot, never a real-time Graph API read. These
// helpers make that explicit instead of implying "ACTIVE" means "right now".

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  ARCHIVED: 'Arquivada',
  DELETED: 'Excluída',
  IN_PROCESS: 'Em processamento',
  WITH_ISSUES: 'Com problemas',
  PENDING_REVIEW: 'Em revisão',
  DISAPPROVED: 'Reprovada',
  PREAPPROVED: 'Pré-aprovada',
  ADSET_PAUSED: 'Conjunto pausado',
  CAMPAIGN_PAUSED: 'Campanha pausada',
};

/**
 * A structural status (effective_status/meta_status) is only ever as fresh as
 * the last sync run that produced the snapshot it came from — Camply never
 * queries Meta live when a list/drawer opens. Label it accordingly so it can't
 * be mistaken for the campaign's real-time state.
 */
export function formatSnapshotStatusLabel(
  effectiveStatus: string | null | undefined,
  status?: string | null
): string {
  const raw = (effectiveStatus || status || '').toUpperCase();
  if (!raw) return 'Status não informado no último sync';
  const friendly = STATUS_LABELS[raw] || raw;
  return `${friendly} no último sync`;
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function isSnapshotStale(syncedAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!syncedAt) return false;
  const time = new Date(syncedAt).getTime();
  if (Number.isNaN(time)) return false;
  return now - time > STALE_THRESHOLD_MS;
}

export function formatSyncedAtLabel(syncedAt: string | null | undefined): string {
  if (!syncedAt) return 'Data da última sincronização não informada';
  const date = new Date(syncedAt);
  if (Number.isNaN(date.getTime())) return 'Data da última sincronização não informada';
  return `Sincronizado em ${date.toLocaleString('pt-BR')}`;
}

export const SNAPSHOT_STALE_WARNING = 'Este snapshot tem mais de 24h — pode estar desatualizado em relação à Meta. Use "Sincronizar com a Meta" para atualizar.';
