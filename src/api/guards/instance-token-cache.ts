/**
 * Token por nome de instância (5 min). O painel aberto com token de instância consultava o banco a
 * cada chamada. Módulo sem dependências para poder ser usado pelo guard e pelo monitor sem ciclo.
 */
const tokenCache = new Map<string, { token: string; at: number }>();
export const TOKEN_TTL_MS = 5 * 60_000;

export async function cachedInstanceToken(
  name: string,
  load: (name: string) => Promise<string | undefined | null>,
): Promise<string | undefined> {
  const hit = tokenCache.get(name);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token;
  const token = await load(name);
  if (token) tokenCache.set(name, { token, at: Date.now() });
  else tokenCache.delete(name);
  return token ?? undefined;
}

export function forgetInstanceToken(name?: string) {
  if (name) tokenCache.delete(name);
  else tokenCache.clear();
}
