/**
 * Harness of the integration tests: the real OpenaiController/OpenaiService on a real (disposable) PostgreSQL,
 * with a fake WhatsApp channel and a fake OpenAI client.
 *
 * Needs TEST_DATABASE_URL (see test/scripts/local-postgres.sh); without it the integration suites are skipped.
 * The migrations of prisma/postgresql-migrations are applied with `prisma migrate deploy` from a temporary copy,
 * so the working tree is never touched.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { OpenaiController } from '@api/integrations/chatbot/openai/controllers/openai.controller';
import { OpenaiService } from '@api/integrations/chatbot/openai/services/openai.service';
import { PrismaRepository } from '@api/repository/repository.service';
import { configService } from '@config/env.config';

import { createFakeOpenai, createFakeWaInstance, FakeOpenai, FakeWaInstance, nextId, textMsg, waitFor } from './fakes';

export const SKIP_INTEGRATION = process.env.TEST_DATABASE_URL
  ? false
  : 'TEST_DATABASE_URL não definido: testes de integração pulados (veja test/scripts/local-postgres.sh)';

const ROOT = resolve(__dirname, '..', '..');

let migrated = false;

/** Applies every PostgreSQL migration to TEST_DATABASE_URL (idempotent; Prisma serialises concurrent runs). */
export function migrateTestDatabase() {
  if (migrated) return;

  const dir = mkdtempSync(join(tmpdir(), 'evolution-test-prisma-'));
  try {
    cpSync(join(ROOT, 'prisma', 'postgresql-schema.prisma'), join(dir, 'schema.prisma'));
    cpSync(join(ROOT, 'prisma', 'postgresql-migrations'), join(dir, 'migrations'), { recursive: true });

    execFileSync(
      join(ROOT, 'node_modules', '.bin', 'prisma'),
      ['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          DATABASE_CONNECTION_URI: process.env.TEST_DATABASE_URL,
          CHECKPOINT_DISABLE: '1',
          PRISMA_HIDE_UPDATE_MESSAGE: '1',
        },
        stdio: 'pipe',
      },
    );
    migrated = true;
  } catch (error) {
    const output = `${error?.stdout ?? ''}${error?.stderr ?? ''}`;
    throw new Error(`prisma migrate deploy failed: ${output || error?.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const UNKNOWN_MESSAGE = 'Desculpe, tive um problema para responder agora. Um atendente vai falar com você.';

export type TenantOptions = { settings?: Record<string, any>; bot?: Record<string, any> };

export type Tenant = Awaited<ReturnType<OpenaiHarness['createTenant']>>;

export class OpenaiHarness {
  readonly prisma = new PrismaRepository(configService);
  readonly waMonitor: any = { waInstances: {} as Record<string, FakeWaInstance> };
  /** Default fake, used for every API key without a fake of its own (see `useOpenaiFor`). */
  readonly openai: FakeOpenai = createFakeOpenai();
  private readonly openaiByApiKey = new Map<string, FakeOpenai>();
  readonly service: any;
  readonly controller: any;
  private readonly instanceIds: string[] = [];

  constructor() {
    this.service = new OpenaiService(this.waMonitor, this.prisma, configService);
    // The service builds its OpenAI client from the stored API key: hand it the fake of that key instead
    this.service.initClient = (apiKey: string) => {
      return this.openaiByApiKey.get(apiKey) ?? this.openai;
    };
    this.controller = new OpenaiController(this.service, this.prisma, this.waMonitor);
  }

  async start() {
    migrateTestDatabase();
    await this.prisma.$connect();
    return this;
  }

  async stop() {
    if (this.instanceIds.length) {
      // Cascades to creds, bots, settings and sessions
      await this.prisma.instance.deleteMany({ where: { id: { in: this.instanceIds } } });
    }
    await this.prisma.$disconnect();
  }

  /**
   * Instance + OpenAI creds + settings + chatCompletion bot (triggerType "all"), created through the controller
   * like the REST API does. Defaults: no debounce, stopBotFromMe on, listeningFromMe off, PT-BR unknownMessage.
   */
  async createTenant(options: TenantOptions = {}) {
    const name = `it-${nextId()}`.toLowerCase();
    const row = await this.prisma.instance.create({
      data: { name, integration: 'WHATSAPP-BAILEYS', connectionStatus: 'open' },
    });
    this.instanceIds.push(row.id);

    const instance = { instanceName: name, instanceId: row.id };
    const wa = createFakeWaInstance(name, row.id);
    this.waMonitor.waInstances[name] = wa;

    const creds = await this.controller.createOpenaiCreds(instance, {
      name: `creds-${name}`,
      apiKey: `sk-test-${name}`,
    });

    const settings = await this.controller.settings(instance, {
      openaiCredsId: creds.id,
      expire: 0,
      keywordFinish: '#sair',
      delayMessage: 0,
      unknownMessage: UNKNOWN_MESSAGE,
      listeningFromMe: false,
      stopBotFromMe: true,
      keepOpen: false,
      debounceTime: 0,
      ignoreJids: [],
      splitMessages: false,
      timePerChar: 0,
      speechToText: false,
      tokenParam: 'auto',
      humanResumeMinutes: 0,
      ...options.settings,
    });

    const bot = await this.controller.createBot(instance, {
      enabled: true,
      description: 'Assistente do escritório',
      openaiCredsId: creds.id,
      botType: 'chatCompletion',
      model: 'gpt-4o-mini',
      maxTokens: 300,
      systemMessages: ['Você é a assistente virtual do escritório.'],
      assistantMessages: [],
      userMessages: [],
      triggerType: 'all',
      ...options.bot,
    });

    let contactCounter = 0;

    return {
      name,
      instance,
      wa,
      creds,
      settings,
      bot,
      /** A new contact of this tenant (unique jid). */
      contact: () => `55119${String(Date.now() % 100000000).padStart(8, '0')}${++contactCounter}@s.whatsapp.net`,
      /** Message of the contact. */
      client: (remoteJid: string, text: string, options: Parameters<typeof textMsg>[2] = {}) =>
        this.controller.emit({ instance, remoteJid, msg: textMsg(remoteJid, text, options) }),
      /** Message of the owner of the number typed on the phone (fromMe, id never registered). */
      human: (remoteJid: string, text: string, options: Parameters<typeof textMsg>[2] = {}) =>
        this.controller.emit({ instance, remoteJid, msg: textMsg(remoteJid, text, { ...options, fromMe: true }) }),
      session: (remoteJid: string) =>
        this.prisma.integrationSession.findFirst({
          where: { instanceId: row.id, remoteJid },
          orderBy: { createdAt: 'desc' },
        }),
      sessions: (remoteJid: string) =>
        this.prisma.integrationSession.findMany({ where: { instanceId: row.id, remoteJid } }),
      texts: () => wa.sent.filter((s) => s.kind === 'text').map((s) => s.data.text),
      statusEvents: () => wa.webhooks.filter((w) => w.event === 'openai.change_status').map((w) => w.data),
    };
  }

  /** Gives a tenant (its API key) a fake OpenAI client of its own. */
  useOpenaiFor(tenant: Tenant, fake: FakeOpenai = createFakeOpenai()) {
    this.openaiByApiKey.set(tenant.creds.apiKey, fake);
    return fake;
  }

  /** Moves the last human message of a session `msAgo` into the past (instead of waiting for the real clock). */
  async ageHumanPause(sessionId: string, msAgo: number) {
    const session = await this.prisma.integrationSession.findUnique({ where: { id: sessionId } });
    await this.prisma.integrationSession.update({
      where: { id: sessionId },
      data: {
        parameters: {
          ...((session.parameters as any) ?? {}),
          humanLastMessageAt: new Date(Date.now() - msAgo).toISOString(),
        },
      },
    });
  }

  /** Sets updatedAt `msAgo` in the past without Prisma bumping it (column is a UTC timestamp). */
  async ageUpdatedAt(sessionId: string, msAgo: number) {
    await this.prisma
      .$executeRaw`UPDATE "IntegrationSession" SET "updatedAt" = (now() AT TIME ZONE 'UTC') - make_interval(secs => ${Math.round(msAgo / 1000)}::int) WHERE "id" = ${sessionId}`;
  }

  /** Waits until the fire-and-forget change status webhooks of a tenant reach `count`. */
  waitForStatusEvents(tenant: Tenant, count: number) {
    return waitFor(() => tenant.statusEvents().length >= count, 5000, `${count} openai.change_status webhooks`);
  }
}
