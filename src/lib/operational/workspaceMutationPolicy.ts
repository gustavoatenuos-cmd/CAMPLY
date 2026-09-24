export const WORKSPACE_READ_ONLY_MESSAGE =
  'O banco está temporariamente indisponível. O CAMPLY entrou em modo somente leitura para impedir que uma cópia local substitua dados mais recentes.';

export function canMutateWorkspace(remoteLoadError: string | null): boolean {
  return remoteLoadError === null;
}
