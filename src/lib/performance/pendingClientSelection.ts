const STORAGE_KEY = 'camply:pending-client-selection';

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
