import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto, SetPresenceDto } from '@api/dto/instance.dto';
import { clientAccessService, instanceController, teamAccessService, waMonitor } from '@api/server.module';
import { Auth, ConfigService } from '@config/env.config';
import { clientInstanceView, isClientKey } from '@utils/client-access';
import { isTeamKey, teamInstanceView } from '@utils/team-access';
import { instanceSchema, presenceOnlySchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class InstanceRouter extends RouterBroker {
  constructor(
    readonly configService: ConfigService,
    ...guards: RequestHandler[]
  ) {
    super();
    this.router
      .post('/create', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.createInstance(instance),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('restart'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.restartInstance(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('connect'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.connectToWhatsapp(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('connectionState'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.connectionState(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetchInstances', false), ...guards, async (req, res) => {
        // A person session ("was_", Google login) has the same reach as the global key, as decided by the guard:
        // the controller compares the key with the global one to list every instance, so hand it the global key.
        const key = (req as any).userSession
          ? this.configService.get<Auth>('AUTHENTICATION').API_KEY.KEY
          : req.get('apikey');

        // "Acesso do cliente": only its own instance, without the instance token or integration secrets
        if (isClientKey(key)) {
          const grant = await clientAccessService.resolve(key);
          const list = grant ? await waMonitor.instanceInfo([grant.instanceName]) : [];
          return res.status(HttpStatus.OK).json((list ?? []).map((item: any) => clientInstanceView(item, key)));
        }

        // "Equipe": only the instances of the key, without the real instance token (the panel stores
        // `instance.token` and would use it in every request, skipping the role decided on the server)
        if (isTeamKey(key)) {
          const grant = (req as any).teamAccess ?? (await teamAccessService.resolve(key));
          if (!grant) return res.status(HttpStatus.OK).json([]);
          const wanted = typeof req.query?.instanceName === 'string' ? req.query.instanceName : null;
          let names: string[] | null = grant.instanceNames;
          if (wanted) names = !names || names.includes(wanted) ? [wanted] : [];
          // a scoped instance that was removed meanwhile must not fail the whole list (instanceInfo throws on it)
          if (names) names = names.filter((name) => !!waMonitor.waInstances?.[name]);
          const list = names && !names.length ? [] : await waMonitor.instanceInfo(names ?? undefined);
          return res.status(HttpStatus.OK).json((list ?? []).map((item: any) => teamInstanceView(item, key)));
        }

        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.fetchInstances(instance, key),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('setPresence'), ...guards, async (req, res) => {
        const response = await this.dataValidate<null>({
          request: req,
          schema: presenceOnlySchema,
          ClassRef: SetPresenceDto,
          execute: (instance, data) => instanceController.setPresence(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .delete(this.routerPath('logout'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.logout(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .delete(this.routerPath('delete'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.deleteInstance(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
