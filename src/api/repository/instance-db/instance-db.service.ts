import { spawn } from 'node:child_process';

import { NeonClient } from './neon.client';
import { deriveKey, open, redactUrl, seal } from './secret-box';

/**
 * Banco de dados próprio por instância (um projeto Neon por instância).
 *
 * Arquitetura:
 * - O banco "principal" (DATABASE_CONNECTION_URI) é o plano de controle: guarda a tabela
 *   `Instance` de todas as instâncias e o mapeamento `InstanceDatabase`. Instâncias sem
 *   mapeamento continuam 100% no banco principal (comportamento de antes).
 * - Quando ligado, cada instância NOVA ganha um projeto Neon próprio (cota de 100 CU-h só dela).
 *   Todas as tabelas da instância (mensagens, chats, contatos, chaves do WhatsApp, bot...)
 *   vão para esse banco; a linha `Instance` é espelhada lá só para as chaves estrangeiras.
 * - O roteamento é feito por `createRoutedRepository` (routing.ts).
 */

export type InstanceDbStatus = 'provisioning' | 'ready' | 'failed' | 'detached';

export interface InstanceDbConfig {
  enabled: boolean;
  /** Apaga o projeto Neon ao remover a instância (padrão: não, os dados ficam guardados). */
  deleteOnRemove: boolean;
  /** Roda `prisma migrate deploy` em cada banco de instância ao iniciar o servidor. */
  migrateOnBoot: boolean;
  connectionLimit: number;
  projectPrefix: string;
  /** Projetos permitidos no plano do Neon (Free: 100), contando o do banco principal. */
  projectLimit?: number;
}

/** Cota de projetos do Neon, para a escolha "banco próprio / compartilhado" ao criar uma instância. */
export interface InstanceDbQuota {
  enabled: boolean;
  /** Modo que o painel deve sugerir: "own" enquanto houver projeto livre. */
  defaultMode: 'own' | 'shared';
  limit: number;
  /** Projetos em uso (null quando o Neon não respondeu e não há estimativa). */
  used: number | null;
  remaining: number | null;
  ownInstances: number;
  /** De onde veio o número: API do Neon, estimativa local (Neon fora) ou desligado. */
  source: 'neon' | 'estimate' | 'off';
}

const QUOTA_CACHE_MS = 60_000;

export interface InstanceDbLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** Subconjunto do PrismaClient usado aqui (facilita testes). */
export interface MinimalClient {
  instance: any;
  instanceDatabase?: any;
  $disconnect(): Promise<void>;
}

export interface InstanceDbDeps<C extends MinimalClient = MinimalClient> {
  control: C;
  neon?: NeonClient | null;
  encryptionKey: Buffer;
  createClient: (url: string) => C;
  migrate: (url: string) => Promise<void>;
  logger: InstanceDbLogger;
}

interface Entry<C> {
  status: InstanceDbStatus;
  client?: C;
  projectId?: string | null;
}

export function readInstanceDbConfig(env: NodeJS.ProcessEnv = process.env): InstanceDbConfig & {
  neonApiKey?: string;
  neonOrgId?: string;
  neonRegionId: string;
  neonPgVersion: number;
  neonMaxCu: number;
  secret?: string;
} {
  const provider = (env.DATABASE_PROVIDER ?? 'postgresql').toLowerCase();
  const wanted = env.DB_PER_INSTANCE_ENABLED === 'true';
  const neonApiKey = env.NEON_API_KEY || undefined;
  return {
    enabled: wanted && !!neonApiKey && provider === 'postgresql',
    deleteOnRemove: env.DB_PER_INSTANCE_DELETE_ON_REMOVE === 'true',
    migrateOnBoot: env.DB_PER_INSTANCE_MIGRATE_ON_BOOT !== 'false',
    connectionLimit: clampInt(env.DB_PER_INSTANCE_CONNECTION_LIMIT, 3, 1, 20),
    projectPrefix: (env.DB_PER_INSTANCE_PROJECT_PREFIX || 'whatsai').slice(0, 20),
    projectLimit: clampInt(env.NEON_PROJECT_LIMIT, 100, 1, 10_000),
    neonApiKey,
    neonOrgId: env.NEON_ORG_ID || undefined,
    neonRegionId: env.NEON_REGION_ID || 'aws-us-east-2',
    neonPgVersion: clampInt(env.NEON_PG_VERSION, 16, 14, 18),
    neonMaxCu: clampFloat(env.NEON_MAX_CU, 0.25, 0.25, 2),
    secret: env.DB_PER_INSTANCE_SECRET || env.AUTHENTICATION_API_KEY || undefined,
  };
}

export class InstanceDatabaseService<C extends MinimalClient = MinimalClient> {
  private readonly entries = new Map<string, Entry<C>>();
  private readonly pending = new Map<string, Promise<void>>();
  private dedicatedCount = 0;
  private quotaCache: { at: number; value: InstanceDbQuota } | null = null;

  constructor(
    private readonly config: InstanceDbConfig,
    private readonly deps: InstanceDbDeps<C> | null,
  ) {}

  /** Provisionamento automático ligado (env + chave do Neon). */
  get enabled(): boolean {
    return this.config.enabled && !!this.deps?.neon;
  }

  /** Há ao menos uma instância com banco próprio carregada (liga o roteamento). */
  hasDedicated(): boolean {
    return this.dedicatedCount > 0;
  }

  /** Cliente do banco próprio da instância, ou null se ela usa o banco principal. */
  dedicatedClient(instanceId: string | null | undefined): C | null {
    if (!instanceId || this.dedicatedCount === 0) return null;
    const entry = this.entries.get(instanceId);
    return entry?.status === 'ready' && entry.client ? entry.client : null;
  }

  status(instanceId: string): InstanceDbStatus | 'shared' {
    return this.entries.get(instanceId)?.status ?? 'shared';
  }

  /**
   * Cota de projetos do Neon (cache de 1 min). Nunca lança: com o Neon fora, devolve uma estimativa
   * (instâncias com banco próprio + o projeto do banco principal).
   */
  async quota(force = false): Promise<InstanceDbQuota> {
    const limit = this.config.projectLimit ?? 100;
    const ownInstances = this.dedicatedCount;
    if (!this.enabled) {
      return { enabled: false, defaultMode: 'shared', limit, used: null, remaining: null, ownInstances, source: 'off' };
    }
    if (!force && this.quotaCache && Date.now() - this.quotaCache.at < QUOTA_CACHE_MS) return this.quotaCache.value;

    let used: number;
    let source: InstanceDbQuota['source'] = 'neon';
    try {
      used = await this.deps!.neon!.countProjects();
    } catch (error) {
      this.deps!.logger.warn(`instance-db: cota do Neon indisponível (${errMsg(error)}); usando estimativa`);
      used = ownInstances + 1;
      source = 'estimate';
    }
    const remaining = Math.max(0, limit - used);
    const value: InstanceDbQuota = {
      enabled: true,
      defaultMode: remaining > 0 ? 'own' : 'shared',
      limit,
      used,
      remaining,
      ownInstances,
      source,
    };
    this.quotaCache = { at: Date.now(), value };
    return value;
  }

  /** Espera um provisionamento em andamento (se houver). */
  async ready(instanceId: string): Promise<void> {
    await this.pending.get(instanceId);
  }

  /** Carrega os mapeamentos do banco principal e aplica migrations nos bancos de instância. */
  async init(): Promise<void> {
    if (!this.deps?.control?.instanceDatabase) return;
    const { control, logger } = this.deps;
    let rows: any[] = [];
    try {
      rows = await control.instanceDatabase.findMany({ where: { status: 'ready' } });
    } catch (error) {
      // Tabela ainda não migrada ou banco fora: segue tudo no banco principal.
      logger.warn(`instance-db: mapeamentos indisponíveis (${errMsg(error)})`);
      return;
    }

    for (const row of rows) {
      let url: string;
      try {
        url = withConnectionLimit(open(row.connectionUri, this.deps.encryptionKey), this.config.connectionLimit);
      } catch (error) {
        // Sem conseguir abrir a URL não dá para atender a instância; NÃO cai no banco principal
        // (isso misturaria dados). A instância fica com erro até a chave ser corrigida.
        logger.error(`instance-db: não foi possível abrir a URL da instância ${row.instanceId}: ${errMsg(error)}`);
        this.entries.set(row.instanceId, { status: 'failed', projectId: row.externalProjectId });
        continue;
      }

      if (this.config.migrateOnBoot) {
        try {
          await this.deps.migrate(url);
          await control.instanceDatabase.update({ where: { id: row.id }, data: { migratedAt: new Date() } });
        } catch (error) {
          // Banco suspenso (cota esgotada) ou migration falhou: a instância continua apontando
          // para o próprio banco (isolamento); só ela é afetada.
          logger.error(`instance-db: migrations falharam para ${row.instanceId}: ${errMsg(error)}`);
        }
      }

      this.attach(row.instanceId, this.deps.createClient(url), row.externalProjectId);
    }

    if (rows.length) logger.info(`instance-db: ${this.dedicatedCount} instância(s) com banco próprio`);
  }

  /**
   * Cria o projeto Neon da instância, aplica as migrations, espelha a linha `Instance` e
   * registra o mapeamento. Em erro, desfaz o que criou e lança (a criação da instância falha).
   */
  provision(instanceId: string, instanceName: string): Promise<void> {
    if (!this.enabled || !this.deps) return Promise.resolve();
    const existing = this.pending.get(instanceId);
    if (existing) return existing;

    const job = this.doProvision(instanceId, instanceName).finally(() => this.pending.delete(instanceId));
    this.pending.set(instanceId, job);
    return job;
  }

  private async doProvision(instanceId: string, instanceName: string): Promise<void> {
    const { control, neon, logger } = this.deps!;
    const started = Date.now();
    const quota = await this.quota();
    if (quota.source === 'neon' && quota.remaining === 0) {
      throw new Error(
        `Não foi possível criar o banco próprio da instância: o limite de ${quota.limit} projetos do Neon foi atingido. ` +
          'Crie a instância como compartilhada ou libere um projeto no Neon.',
      );
    }
    this.quotaCache = null;
    this.entries.set(instanceId, { status: 'provisioning' });

    let projectId: string | null = null;
    let mappingId: string | null = null;
    let client: C | null = null;
    try {
      const project = await neon!.createProject(projectName(this.config.projectPrefix, instanceName, instanceId));
      projectId = project.projectId;

      const mapping = await control.instanceDatabase.create({
        data: {
          instanceId,
          provider: 'neon',
          externalProjectId: project.projectId,
          region: project.regionId,
          connectionUri: seal(project.connectionUri, this.deps!.encryptionKey),
          status: 'provisioning',
        },
      });
      mappingId = mapping.id;

      await neon!.waitForOperations(project.projectId);
      const url = withConnectionLimit(project.connectionUri, this.config.connectionLimit);
      await retry(() => this.deps!.migrate(url), 3, 3_000);

      client = this.deps!.createClient(url);
      const row = await control.instance.findUnique({ where: { id: instanceId } });
      if (!row) throw new Error('linha Instance não encontrada no banco principal');
      await client.instance.upsert({ where: { id: instanceId }, create: row, update: {} });

      await control.instanceDatabase.update({
        where: { id: mapping.id },
        data: { status: 'ready', migratedAt: new Date(), lastError: null },
      });
      this.attach(instanceId, client, project.projectId);
      logger.info(
        `instance-db: banco próprio criado para "${instanceName}" (projeto ${project.projectId}) em ${Math.round(
          (Date.now() - started) / 1000,
        )}s`,
      );
    } catch (error) {
      const message = errMsg(error);
      logger.error(`instance-db: falha ao criar banco de "${instanceName}": ${message}`);
      this.entries.delete(instanceId);
      await client?.$disconnect().catch(() => undefined);
      if (projectId) await neon!.deleteProject(projectId).catch(() => undefined);
      if (mappingId) {
        await control.instanceDatabase
          .update({ where: { id: mappingId }, data: { status: 'failed', lastError: message.slice(0, 1000) } })
          .catch(() => undefined);
      }
      throw new Error(`Não foi possível criar o banco próprio da instância: ${message}`);
    }
  }

  /** Solta o banco da instância (ao remover). Por padrão mantém o projeto Neon (dados guardados). */
  async release(instanceId: string): Promise<void> {
    const entry = this.entries.get(instanceId);
    if (!entry || !this.deps) return;
    // Mesma semântica do banco compartilhado: remover a instância apaga os dados dela
    // (a linha Instance espelhada tem ON DELETE CASCADE nas tabelas filhas).
    await entry.client?.instance
      ?.deleteMany({ where: { id: instanceId } })
      .catch((error: unknown) => this.deps!.logger.error(`instance-db: limpeza de ${instanceId}: ${errMsg(error)}`));

    this.entries.delete(instanceId);
    this.quotaCache = null;
    if (entry.status === 'ready') this.dedicatedCount = Math.max(0, this.dedicatedCount - 1);
    await entry.client?.$disconnect().catch(() => undefined);

    let status: InstanceDbStatus = 'detached';
    if (this.config.deleteOnRemove && entry.projectId && this.deps.neon) {
      try {
        await this.deps.neon.deleteProject(entry.projectId);
      } catch (error) {
        this.deps.logger.error(`instance-db: falha ao apagar projeto ${entry.projectId}: ${errMsg(error)}`);
        status = 'failed';
      }
    }
    await this.deps.control.instanceDatabase
      ?.updateMany({ where: { instanceId }, data: { status } })
      .catch(() => undefined);
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.entries.values()].map((e) => e.client?.$disconnect().catch(() => undefined)));
  }

  private attach(instanceId: string, client: C, projectId?: string | null) {
    const prev = this.entries.get(instanceId);
    if (prev?.status !== 'ready') this.dedicatedCount++;
    this.entries.set(instanceId, { status: 'ready', client, projectId });
  }
}

/** `prisma migrate deploy` contra uma URL (sem imprimir a URL). */
export function prismaMigrateDeploy(schemaPath = './prisma/postgresql-schema.prisma', timeoutMs = 180_000) {
  return (url: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn('npx', ['prisma', 'migrate', 'deploy', '--schema', schemaPath], {
        env: { ...process.env, DATABASE_CONNECTION_URI: url },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      const onData = (b: Buffer) => {
        out = (out + b.toString()).slice(-4000);
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve();
        const tail = redactUrl(out.split(url).join('<url>')).trim().split('\n').slice(-6).join(' | ');
        reject(new Error(`prisma migrate deploy saiu com código ${code}: ${tail}`));
      });
    });
}

export function buildEncryptionKey(secret: string | undefined): Buffer {
  return deriveKey(secret ?? '');
}

export function projectName(prefix: string, instanceName: string, instanceId: string): string {
  const slug =
    String(instanceName ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'instancia';
  return `${prefix}-${slug}-${String(instanceId).slice(0, 8)}`;
}

export function withConnectionLimit(url: string, limit: number): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', String(limit));
    return u.toString();
  } catch {
    return url;
  }
}

async function retry(fn: () => Promise<void>, attempts: number, delayMs: number): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

function errMsg(error: unknown): string {
  return redactUrl(error instanceof Error ? error.message : String(error));
}

function clampInt(v: string | undefined, def: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

function clampFloat(v: string | undefined, def: number, min: number, max: number): number {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
