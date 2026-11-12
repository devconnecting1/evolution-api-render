import { CacheEngine } from '@cache/cacheengine';
import { Auth, Chatwoot, configService, Database, Processos, ProviderSession } from '@config/env.config';
import { eventEmitter } from '@config/event.config';
import { Logger } from '@config/logger.config';
import { parseAllowlist } from '@utils/google-login';
import { openaiHealthRegistry } from '@utils/openai-health';
import { setProcessAiContextProvider } from '@utils/processos/aiContext';

import { AgendaController } from './controllers/agenda.controller';
import { BusinessController } from './controllers/business.controller';
import { CallController } from './controllers/call.controller';
import { ChatController } from './controllers/chat.controller';
import { ExportController } from './controllers/export.controller';
import { GroupController } from './controllers/group.controller';
import { InstanceController } from './controllers/instance.controller';
import { LabelController } from './controllers/label.controller';
import { LeadsController } from './controllers/leads.controller';
import { OverviewController } from './controllers/overview.controller';
import { ProcessosController } from './controllers/processos.controller';
import { ProxyController } from './controllers/proxy.controller';
import { SendMessageController } from './controllers/sendMessage.controller';
import { SettingsController } from './controllers/settings.controller';
import { TemplateController } from './controllers/template.controller';
import { UsageController } from './controllers/usage.controller';
import { ChannelController } from './integrations/channel/channel.controller';
import { EvolutionController } from './integrations/channel/evolution/evolution.controller';
import { MetaController } from './integrations/channel/meta/meta.controller';
import { BaileysController } from './integrations/channel/whatsapp/baileys.controller';
import { ChatbotController } from './integrations/chatbot/chatbot.controller';
import { ChatwootController } from './integrations/chatbot/chatwoot/controllers/chatwoot.controller';
import { ChatwootService } from './integrations/chatbot/chatwoot/services/chatwoot.service';
import { DifyController } from './integrations/chatbot/dify/controllers/dify.controller';
import { DifyService } from './integrations/chatbot/dify/services/dify.service';
import { EvoaiController } from './integrations/chatbot/evoai/controllers/evoai.controller';
import { EvoaiService } from './integrations/chatbot/evoai/services/evoai.service';
import { EvolutionBotController } from './integrations/chatbot/evolutionBot/controllers/evolutionBot.controller';
import { EvolutionBotService } from './integrations/chatbot/evolutionBot/services/evolutionBot.service';
import { FlowiseController } from './integrations/chatbot/flowise/controllers/flowise.controller';
import { FlowiseService } from './integrations/chatbot/flowise/services/flowise.service';
import { N8nController } from './integrations/chatbot/n8n/controllers/n8n.controller';
import { N8nService } from './integrations/chatbot/n8n/services/n8n.service';
import { OpenaiController } from './integrations/chatbot/openai/controllers/openai.controller';
import { OpenaiService } from './integrations/chatbot/openai/services/openai.service';
import { TypebotController } from './integrations/chatbot/typebot/controllers/typebot.controller';
import { TypebotService } from './integrations/chatbot/typebot/services/typebot.service';
import { EventManager } from './integrations/event/event.manager';
import { S3Controller } from './integrations/storage/s3/controllers/s3.controller';
import { S3Service } from './integrations/storage/s3/services/s3.service';
import { ProviderFiles } from './provider/sessions';
import { createInstanceDatabases, createRoutedRepository } from './repository/instance-db';
import { PrismaRepository } from './repository/repository.service';
import { adminAlertsConfigFromEnv, AdminAlertsService } from './services/admin-alerts.service';
import { AgendaService } from './services/agenda.service';
import { CacheService } from './services/cache.service';
import { ClientAccessService } from './services/client-access.service';
import { ExportService } from './services/export.service';
import { GoogleCalendarService } from './services/google-calendar.service';
import { GoogleLoginService } from './services/google-login.service';
import { LeadsService } from './services/leads.service';
import { WAMonitoringService } from './services/monitor.service';
import { OpenaiHealthService } from './services/openai-health.service';
import { OverviewService } from './services/overview.service';
import { ProcessosService } from './services/processos.service';
import { ProxyService } from './services/proxy.service';
import { retentionDaysFromEnv, RetentionService } from './services/retention.service';
import { SettingsService } from './services/settings.service';
import { TemplateService } from './services/template.service';
import { UsageService } from './services/usage.service';
import { UserSessionService } from './services/user-session.service';

const logger = new Logger('WA MODULE');

let chatwootCache: CacheService = null;
if (configService.get<Chatwoot>('CHATWOOT').ENABLED) {
  chatwootCache = new CacheService(new CacheEngine(configService, ChatwootService.name).getEngine());
}

export const cache = new CacheService(new CacheEngine(configService, 'instance').getEngine());
const baileysCache = new CacheService(new CacheEngine(configService, 'baileys').getEngine());

let providerFiles: ProviderFiles = null;
if (configService.get<ProviderSession>('PROVIDER').ENABLED) {
  providerFiles = new ProviderFiles(configService);
}

// Banco principal (plano de controle) + roteamento para o banco próprio de cada instância.
const controlPrisma = new PrismaRepository(configService);
export const instanceDatabases = createInstanceDatabases(controlPrisma);
export const prismaRepository: PrismaRepository = createRoutedRepository(controlPrisma, instanceDatabases, {
  warn: (msg: string) => logger.warn(msg),
});

export const waMonitor = new WAMonitoringService(
  eventEmitter,
  configService,
  prismaRepository,
  providerFiles,
  cache,
  chatwootCache,
  baileysCache,
);

const s3Service = new S3Service(prismaRepository);
export const s3Controller = new S3Controller(s3Service);

const templateService = new TemplateService(waMonitor, prismaRepository, configService);
export const templateController = new TemplateController(templateService);

const proxyService = new ProxyService(waMonitor);
export const proxyController = new ProxyController(proxyService, waMonitor);

const chatwootService = new ChatwootService(waMonitor, configService, prismaRepository, chatwootCache);
export const chatwootController = new ChatwootController(chatwootService, configService);

const settingsService = new SettingsService(waMonitor);
export const settingsController = new SettingsController(settingsService);

export const instanceController = new InstanceController(
  waMonitor,
  configService,
  prismaRepository,
  eventEmitter,
  chatwootService,
  settingsService,
  proxyController,
  cache,
  chatwootCache,
  baileysCache,
  providerFiles,
);
export const sendMessageController = new SendMessageController(waMonitor);
export const callController = new CallController(waMonitor);
export const chatController = new ChatController(waMonitor);
export const businessController = new BusinessController(waMonitor);
export const groupController = new GroupController(waMonitor);
export const labelController = new LabelController(waMonitor);

// A pessoa com sessão do Google ("was_") entra no WebSocket como a chave global. O resolvedor é lido a cada
// conexão (depois de o módulo estar montado), nunca durante a subida.
export const eventManager = new EventManager(prismaRepository, waMonitor, {
  resolveSession: (token) => userSessionService.resolve(token),
});
export const chatbotController = new ChatbotController(prismaRepository, waMonitor);
export const channelController = new ChannelController(prismaRepository, waMonitor);

// channels
export const evolutionController = new EvolutionController(prismaRepository, waMonitor);
export const metaController = new MetaController(prismaRepository, waMonitor);
export const baileysController = new BaileysController(waMonitor);

// "Plano e limites": one instance, so the limits cache invalidated by the REST routes is the one the bot reads
const retentionLogger = new Logger('Retention');
/** Retenção das mensagens (LGPD): MESSAGE_RETENTION_DAYS (0 = desligada, mínimo 30). */
export const retentionService = new RetentionService({
  prisma: prismaRepository,
  days: retentionDaysFromEnv(),
  logger: { log: (m) => retentionLogger.log(m), warn: (m) => retentionLogger.warn(m) },
});
export const usageService = new UsageService(prismaRepository, {
  onDaily: (instanceId) => retentionService.runOncePerDay(instanceId),
});
/** "Acesso do cliente": códigos de acesso do cliente com módulos escolhidos (src/utils/client-access.ts). */
export const clientAccessService = new ClientAccessService({ prisma: prismaRepository });
export const usageController = new UsageController(usageService, prismaRepository);
/** "Exportar dados da instância": read-only ZIP of the instance data (src/api/services/export.service.ts). */
export const exportService = new ExportService(prismaRepository);
export const exportController = new ExportController(exportService, prismaRepository);

// "Processos" (DataJud + DJEN): one instance (in-memory ticker state, rate limits, AI context provider)
const processosConfig = configService.get<Processos>('PROCESSOS');
const processosLogger = new Logger('Processos');
export const processosService = new ProcessosService(prismaRepository, waMonitor, {
  datajudApiKey: processosConfig.DATAJUD_API_KEY,
  datajudBaseUrl: processosConfig.DATAJUD_BASE_URL,
  djenBaseUrl: processosConfig.DJEN_BASE_URL,
  logger: {
    log: (m) => processosLogger.log(m),
    warn: (m) => processosLogger.warn(m),
    error: (m) => processosLogger.error(m),
  },
});
export const processosController = new ProcessosController(processosService);
setProcessAiContextProvider((instanceId, remoteJid) => processosService.aiContext(instanceId, remoteJid));

// "Visão Geral com o resultado do escritório": read-only numbers of the first screen; no timer, only when the panel opens
export const overviewService = new OverviewService(prismaRepository, {
  processesBadge: (instanceId) => processosService.badge(instanceId),
});
export const overviewController = new OverviewController(overviewService, prismaRepository);

// "Leads (triagem)": the bot hands every answered conversation to it (in the background); same instance as the routes
export const leadsService = new LeadsService(prismaRepository, usageService, waMonitor, {
  provider: configService.get<Database>('DATABASE').PROVIDER,
});
export const leadsController = new LeadsController(leadsService, prismaRepository, waMonitor);

// "Agenda": one instance shared by the REST routes, the MCP and the bot (settings cache + reminder ticker)
// Google Agenda (opcional): GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET no Render; sem eles, "não configurada"
const googleLogger = new Logger('GoogleAgenda');
const serverUrl = String(process.env.SERVER_URL || '')
  .trim()
  .replace(/\/+$/, '');
export const googleCalendarService = new GoogleCalendarService(prismaRepository, {
  clientId: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
  redirectUri:
    process.env.GOOGLE_REDIRECT_URI?.trim() || (serverUrl ? `${serverUrl}/agenda/google/callback` : undefined),
  returnUrl: process.env.GOOGLE_RETURN_URL?.trim() || 'https://whatsaibr.vercel.app',
  secret:
    process.env.GOOGLE_TOKEN_KEY?.trim() || `apikey:${configService.get<Auth>('AUTHENTICATION').API_KEY.KEY ?? ''}`,
  log: (level, message) => googleLogger[level](message),
});
// "Equipe" (proposta V, etapa 1): login com Google por pessoa + sessões revogáveis. Sem as envs, o recurso fica
// desligado e a chave global continua entrando (break-glass). Nada aqui chama o Google ao subir a API.
const teamLogger = new Logger('Equipe');
export const googleLoginService = new GoogleLoginService({
  clientId: process.env.GOOGLE_LOGIN_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
  clientSecret: process.env.GOOGLE_LOGIN_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
  redirectUri:
    process.env.GOOGLE_LOGIN_REDIRECT_URI?.trim() || (serverUrl ? `${serverUrl}/auth/google/callback` : undefined),
  returnUrl: process.env.GOOGLE_LOGIN_RETURN_URL?.trim() || 'https://whatsaibr.vercel.app/manager/login',
  allowlist: parseAllowlist(process.env.GOOGLE_LOGIN_OWNER_EMAILS),
  secret:
    process.env.GOOGLE_LOGIN_STATE_SECRET?.trim() ||
    process.env.GOOGLE_TOKEN_KEY?.trim() ||
    `apikey:${configService.get<Auth>('AUTHENTICATION').API_KEY.KEY ?? ''}`,
  log: (level, message) => teamLogger[level](message),
});
// A session only counts while the feature is on and the e-mail is still on the allowlist: turning it off (or
// removing the person) ends the live sessions at once, instead of keeping them for up to 30 days.
export const userSessionService = new UserSessionService({
  prisma: prismaRepository,
  authorized: (email) => googleLoginService.available() && googleLoginService.allowlist().includes(email),
  log: (message) => teamLogger.warn(message),
});
export const agendaService = new AgendaService(prismaRepository, waMonitor, { google: googleCalendarService });
export const agendaController = new AgendaController(agendaService, prismaRepository, googleCalendarService);
if (process.env.NODE_ENV !== 'test') agendaService.start();

const openaiService = new OpenaiService(
  waMonitor,
  prismaRepository,
  configService,
  usageService,
  leadsService,
  agendaService,
);
export const openaiController = new OpenaiController(openaiService, prismaRepository, waMonitor);

// Saúde das chaves OpenAI de cada cliente (só memória + leitura das credenciais quando alguém pede)
export const openaiHealthService = new OpenaiHealthService({ prisma: prismaRepository });

const adminAlertsLogger = new Logger('AdminAlerts');
/** Avisos ao administrador pelo WhatsApp (ADMIN_ALERT_NUMBERS + ADMIN_ALERT_INSTANCE; sem eles, desligado). */
export const adminAlertsService = new AdminAlertsService({
  prisma: prismaRepository,
  monitor: waMonitor,
  config: adminAlertsConfigFromEnv(),
  logger: {
    log: (m) => adminAlertsLogger.log(m),
    warn: (m) => adminAlertsLogger.warn(m),
    error: (m) => adminAlertsLogger.error(m),
  },
});
openaiHealthRegistry.onError((credsId, info) => {
  void adminAlertsService.openaiProblem(credsId, info);
});
adminAlertsService.start();

// chatbots
const typebotService = new TypebotService(waMonitor, configService, prismaRepository, openaiService);
export const typebotController = new TypebotController(typebotService, prismaRepository, waMonitor);

const difyService = new DifyService(waMonitor, prismaRepository, configService, openaiService);
export const difyController = new DifyController(difyService, prismaRepository, waMonitor);

const evolutionBotService = new EvolutionBotService(waMonitor, prismaRepository, configService, openaiService);
export const evolutionBotController = new EvolutionBotController(evolutionBotService, prismaRepository, waMonitor);

const flowiseService = new FlowiseService(waMonitor, prismaRepository, configService, openaiService);
export const flowiseController = new FlowiseController(flowiseService, prismaRepository, waMonitor);

const n8nService = new N8nService(waMonitor, prismaRepository, configService, openaiService);
export const n8nController = new N8nController(n8nService, prismaRepository, waMonitor);

const evoaiService = new EvoaiService(waMonitor, prismaRepository, configService, openaiService);
export const evoaiController = new EvoaiController(evoaiService, prismaRepository, waMonitor);

logger.info('Module - ON');
