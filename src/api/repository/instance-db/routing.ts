import { currentInstanceId } from './instance-context';

/**
 * Roteador do Prisma para "banco próprio por instância".
 *
 * Devolve um Proxy do cliente principal (plano de controle) que, para cada consulta,
 * escolhe o banco certo:
 *   1. `instanceId` (ou `sessionId`, para Session/AuthStateKey) nos argumentos da consulta;
 *   2. senão, a instância do contexto assíncrono (`runWithInstance`);
 *   3. senão, o banco principal.
 *
 * Instâncias sem banco próprio continuam no banco principal — e enquanto nenhuma instância
 * tiver banco próprio, o Proxy devolve o cliente original sem nenhuma mudança (caminho rápido).
 */

export interface RoutingRegistry<C = any> {
  hasDedicated(): boolean;
  dedicatedClient(instanceId: string | null | undefined): C | null;
}

export interface RoutingLogger {
  warn(msg: string): void;
}

/** Tabelas globais: sempre no banco principal. */
const CONTROL_MODELS = new Set(['instance', 'instanceDatabase', 'isOnWhatsapp', 'clientAccess', 'globalSetting']);
/** Tabelas cuja chave da instância se chama `sessionId`. */
const SESSION_KEY_MODELS = new Set(['session', 'authStateKey']);
/** Operações de cliente que não passam por um model e seguem o contexto. */
const CONTEXT_OPS = new Set(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe', '$transaction']);
const INSTANCE_WRITE_OPS = new Set(['delete', 'deleteMany']);

export function tenantKeyFor(model: string): 'instanceId' | 'sessionId' {
  return SESSION_KEY_MODELS.has(model) ? 'sessionId' : 'instanceId';
}

function scalarId(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.equals === 'string') return v.equals;
    if (Array.isArray(v.in) && v.in.length === 1 && typeof v.in[0] === 'string') return v.in[0];
  }
  return undefined;
}

/** Extrai a instância dos argumentos de uma consulta Prisma (where/data/create/connect). */
export function extractInstanceId(model: string, args: any): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const key = tenantKeyFor(model);
  const fromObj = (obj: any): string | undefined => {
    if (!obj || typeof obj !== 'object') return undefined;
    const direct = scalarId(obj[key]);
    if (direct) return direct;
    const viaRelation = obj.Instance?.connect?.id;
    if (typeof viaRelation === 'string') return viaRelation;
    if (Array.isArray(obj.AND)) {
      for (const part of obj.AND) {
        const id = fromObj(part);
        if (id) return id;
      }
    }
    // chaves compostas únicas, ex.: where: { remoteJid_instanceId: { remoteJid, instanceId } }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as any)[key] === 'string') {
        return (v as any)[key];
      }
    }
    return undefined;
  };
  return (
    fromObj(args.where) ??
    (Array.isArray(args.data) ? fromObj(args.data[0]) : fromObj(args.data)) ??
    fromObj(args.create)
  );
}

function hasRelationSelection(args: any): boolean {
  const sel = args?.include ?? args?.select;
  if (!sel || typeof sel !== 'object') return false;
  return Object.entries(sel).some(([k, v]) => !!v && (k === '_count' || /^[A-Z]/.test(k)));
}

function relationSelection(args: any): Record<string, unknown> | null {
  const sel = args?.include ?? args?.select;
  if (!sel || typeof sel !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sel)) {
    if (v && (k === '_count' || /^[A-Z]/.test(k))) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function createRoutedRepository<T extends object>(
  control: T,
  registry: RoutingRegistry,
  logger?: RoutingLogger,
): T {
  const warned = new Set<string>();
  const bindCache = new Map<PropertyKey, unknown>();
  const modelProxies = new Map<string, unknown>();

  const warnUnscoped = (model: string, op: string) => {
    const k = `${model}.${op}`;
    if (warned.has(k) || !logger) return;
    warned.add(k);
    logger.warn(`instance-db: consulta ${k} sem instanceId nem contexto de instância; usando o banco principal`);
  };

  const passthrough = (prop: PropertyKey) => {
    const value = Reflect.get(control, prop, control);
    if (typeof value !== 'function') return value;
    let bound = bindCache.get(prop);
    if (!bound) {
      bound = (value as (...a: unknown[]) => unknown).bind(control);
      bindCache.set(prop, bound);
    }
    return bound;
  };

  const isModel = (prop: string) => {
    if (prop.startsWith('$') || prop.startsWith('_')) return false;
    const v = Reflect.get(control, prop, control);
    return !!v && typeof v === 'object' && typeof (v as any).findMany === 'function';
  };

  const modelProxy = (model: string) => {
    let proxy = modelProxies.get(model);
    if (proxy) return proxy;
    proxy = new Proxy(
      {},
      {
        get(_t, op: string) {
          const controlDelegate = Reflect.get(control, model, control) as any;
          const fn = controlDelegate?.[op];
          if (typeof fn !== 'function') return fn;
          return (args?: any, ...rest: unknown[]) => {
            if (!registry.hasDedicated()) return fn.call(controlDelegate, args, ...rest);
            const id = extractInstanceId(model, args) ?? currentInstanceId();
            const dedicated = registry.dedicatedClient(id);
            if (dedicated) return dedicated[model][op](args, ...rest);
            if (!id) warnUnscoped(model, op);
            return fn.call(controlDelegate, args, ...rest);
          };
        },
      },
    );
    modelProxies.set(model, proxy);
    return proxy;
  };

  /** `instance`: sempre no principal; relações (include/_count) vêm do banco da instância. */
  const instanceProxy = new Proxy(
    {},
    {
      get(_t, op: string) {
        const controlDelegate = Reflect.get(control, 'instance', control) as any;
        const fn = controlDelegate?.[op];
        if (typeof fn !== 'function') return fn;
        return (args?: any, ...rest: unknown[]) => {
          const result = fn.call(controlDelegate, args, ...rest);
          if (!registry.hasDedicated()) return result;

          if (INSTANCE_WRITE_OPS.has(op)) return result;
          if (!/^find/.test(op) || !hasRelationSelection(args)) return result;

          const relSel = relationSelection(args);
          return Promise.resolve(result).then(async (rows: any) => {
            const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
            await Promise.all(
              list.map(async (row: any) => {
                const dedicated = row?.id ? registry.dedicatedClient(row.id) : null;
                if (!dedicated || !relSel) return;
                const extra = await dedicated.instance.findUnique({ where: { id: row.id }, select: relSel });
                if (extra) Object.assign(row, extra);
              }),
            );
            return rows;
          });
        };
      },
    },
  );

  return new Proxy(control, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (!registry.hasDedicated()) return passthrough(prop);

      if (prop === 'instance') return instanceProxy;
      if (CONTROL_MODELS.has(prop)) return passthrough(prop);
      if (CONTEXT_OPS.has(prop)) {
        return (...args: unknown[]) => {
          const dedicated = registry.dedicatedClient(currentInstanceId());
          const client: any = dedicated ?? target;
          return client[prop](...args);
        };
      }
      if (isModel(prop)) return modelProxy(prop);
      return passthrough(prop);
    },
  });
}
