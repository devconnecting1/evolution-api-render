import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto assíncrono da instância em execução.
 *
 * Serve para o roteador de banco por instância saber para qual banco mandar uma consulta
 * que não traz o `instanceId` nos argumentos (ex.: `update({ where: { id } })`, `$queryRaw`).
 * Pontos de entrada (rotas HTTP de instância, eventos do Baileys, conexão) rodam dentro de
 * `runWithInstance`; tudo que for aguardado ou agendado a partir dali herda o contexto.
 */
const storage = new AsyncLocalStorage<{ instanceId: string }>();

export function runWithInstance<T>(instanceId: string | null | undefined, fn: () => T): T {
  if (!instanceId) return fn();
  const current = storage.getStore();
  if (current?.instanceId === instanceId) return fn();
  return storage.run({ instanceId }, fn);
}

export function currentInstanceId(): string | undefined {
  return storage.getStore()?.instanceId;
}
