import { safeEqual } from '@api/integrations/mcp/mcp.auth';
import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Auth, configService, Cors, Log, Websocket } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { isSessionToken } from '@utils/google-login';
import { Server } from 'http';
import { Server as SocketIO } from 'socket.io';

import { EmitData, EventController, EventControllerInterface } from '../event.controller';

export type SocketAuthDeps = {
  findInstanceByToken: (token: string) => Promise<unknown | null>;
  globalToken: () => string | undefined;
  /** Person session ("was_", Google login); the same resolver the HTTP guard uses. */
  resolveSession?: (token: string) => Promise<unknown | null>;
};

/**
 * Key accepted by the WebSocket: the global key (constant time, no database), a live person session (same reach
 * as the global key, as in auth.guard.ts) or the token of an instance. A "was_" key is never looked up as an
 * instance token: a refused session is refused, not reinterpreted.
 */
export async function socketKeyAllowed(apiKey: unknown, deps: SocketAuthDeps): Promise<boolean> {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) return false;
  if (isSessionToken(key)) {
    if (!deps.resolveSession) return false;
    return !!(await deps.resolveSession(key).catch(() => null));
  }
  if (safeEqual(key, deps.globalToken())) return true;
  return !!(await deps.findInstanceByToken(key).catch(() => null));
}

export type WebsocketControllerOptions = {
  /** Without it, only the global key and instance tokens get in. */
  resolveSession?: (token: string) => Promise<unknown | null>;
};

export class WebsocketController extends EventController implements EventControllerInterface {
  private io: SocketIO;
  private corsConfig: Array<any>;
  private readonly logger = new Logger('WebsocketController');
  private readonly resolveSession?: (token: string) => Promise<unknown | null>;

  constructor(
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
    options: WebsocketControllerOptions = {},
  ) {
    super(prismaRepository, waMonitor, configService.get<Websocket>('WEBSOCKET')?.ENABLED, 'websocket');

    this.cors = configService.get<Cors>('CORS').ORIGIN;
    this.resolveSession = options.resolveSession;
  }

  public init(httpServer: Server): void {
    if (!this.status) {
      return;
    }

    this.socket = new SocketIO(httpServer, {
      cors: { origin: this.cors },
      allowRequest: async (req, callback) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const params = new URLSearchParams(url.search);

          const { remoteAddress } = req.socket;
          const websocketConfig = configService.get<Websocket>('WEBSOCKET');
          const allowedHosts = websocketConfig.ALLOWED_HOSTS || '127.0.0.1,::1,::ffff:127.0.0.1';
          const allowAllHosts = allowedHosts.trim() === '*';
          const isAllowedHost =
            allowAllHosts ||
            allowedHosts
              .split(',')
              .map((h) => h.trim())
              .includes(remoteAddress);

          if (params.has('EIO') && isAllowedHost) {
            return callback(null, true);
          }

          const apiKey = params.get('apikey') || (req.headers.apikey as string);

          if (!apiKey) {
            this.logger.error('Connection rejected: apiKey not provided');
            return callback('apiKey is required', false);
          }

          const allowed = await socketKeyAllowed(apiKey, {
            findInstanceByToken: (token) => this.prismaRepository.instance.findFirst({ where: { token } }),
            globalToken: () => configService.get<Auth>('AUTHENTICATION').API_KEY.KEY,
            resolveSession: this.resolveSession,
          });

          if (!allowed) {
            this.logger.error('Connection rejected: invalid api key');
            return callback('Invalid api key', false);
          }

          callback(null, true);
        } catch (error) {
          this.logger.error('Authentication error:');
          this.logger.error(error);
          callback('Authentication error', false);
        }
      },
    });

    this.socket.on('connection', (socket) => {
      this.logger.info('User connected');

      socket.on('disconnect', () => {
        this.logger.info('User disconnected');
      });

      socket.on('sendNode', async (data) => {
        try {
          await this.waMonitor.waInstances[data.instanceId].baileysSendNode(data.stanza);
          this.logger.info('Node sent successfully');
        } catch (error) {
          this.logger.error('Error sending node:');
          this.logger.error(error);
        }
      });
    });

    this.logger.info('Socket.io initialized');
  }

  private set cors(cors: Array<any>) {
    this.corsConfig = cors;
  }

  private get cors(): string | Array<any> {
    return this.corsConfig?.includes('*') ? '*' : this.corsConfig;
  }

  private set socket(socket: SocketIO) {
    this.io = socket;
  }

  public get socket(): SocketIO {
    return this.io;
  }

  public async emit({
    instanceName,
    origin,
    event,
    data,
    serverUrl,
    dateTime,
    sender,
    apiKey,
    integration,
    extra,
  }: EmitData): Promise<void> {
    if (integration && !integration.includes('websocket')) {
      return;
    }

    if (!this.status) {
      return;
    }

    const configEv = event.replace(/[.-]/gm, '_').toUpperCase();
    const logEnabled = configService.get<Log>('LOG').LEVEL.includes('WEBSOCKET');
    const message = {
      ...(extra ?? {}),
      event,
      instance: instanceName,
      data,
      server_url: serverUrl,
      date_time: dateTime,
      sender,
      apikey: apiKey,
    };

    if (configService.get<Websocket>('WEBSOCKET')?.GLOBAL_EVENTS) {
      this.socket.emit(event, message);

      if (logEnabled) {
        this.logger.log({ local: `${origin}.sendData-WebsocketGlobal`, ...message });
      }
    }

    try {
      const instance = await this.get(instanceName);

      if (!instance?.enabled) {
        return;
      }

      if (Array.isArray(instance?.events) && instance?.events.includes(configEv)) {
        this.socket.of(`/${instanceName}`).emit(event, message);

        if (logEnabled) {
          this.logger.log({ local: `${origin}.sendData-Websocket`, ...message });
        }
      }
    } catch (err) {
      if (logEnabled) {
        this.logger.log(err);
      }
    }
  }
}
