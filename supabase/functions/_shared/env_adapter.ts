export function getEnvVar(key: string): string | undefined {
  const g = globalThis as Record<string, any>;
  if (g.Deno && g.Deno.env) {
    return g.Deno.env.get(key) as string | undefined;
  }
  if (g.process && g.process.env) {
    return g.process.env[key] as string | undefined;
  }
  return undefined;
}
