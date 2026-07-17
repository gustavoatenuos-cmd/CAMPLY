import { dashboardPeriods, type DashboardPeriod } from './analyticsCapabilities';

const STORAGE_KEY = 'camply:pending-client-selection';
const PERIOD_STORAGE_KEY = 'camply:pending-analytics-period';

/**
 * Passa um clientId de uma tela para outra quando a navegação é só um
 * `setActiveView` (sem estado de rota compartilhado). Quem lê o valor decide
 * se ainda é válido (ex: conferindo se o id existe na lista de clientes
 * carregada); por isso a leitura aqui não remove a chave - views que o
 * usuário reabre depois (sem vir de um clique "Ver análise"/"Editar")
 * continuam vendo a última seleção, o que é preferível a perdê-la por causa
 * de uma dupla invocação em StrictMode.
 */
export function setPendingClientSelection(clientId: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, clientId);
  } catch {
    // sessionStorage indisponível (modo privado, SSR de teste, etc.) - navegação sem preseleção.
  }
}

export function readPendingClientSelection(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Same handoff pattern as the client selection above, for the Dashboard's
 * currently-selected period - the Analytics screen owns an independent
 * `usePerformanceDashboard` period state, so without this a "Ver análise"
 * click from a `last_7d` Dashboard would silently reopen Analytics on its
 * own unrelated default period instead of the one the user was looking at.
 */
export function setPendingAnalyticsPeriod(period: DashboardPeriod): void {
  try {
    window.sessionStorage.setItem(PERIOD_STORAGE_KEY, period);
  } catch {
    // sessionStorage indisponível - Analytics abre com o período padrão do hook.
  }
}

export function readPendingAnalyticsPeriod(): DashboardPeriod | null {
  try {
    const value = window.sessionStorage.getItem(PERIOD_STORAGE_KEY);
    return value && (dashboardPeriods as readonly string[]).includes(value) ? (value as DashboardPeriod) : null;
  } catch {
    return null;
  }
}
