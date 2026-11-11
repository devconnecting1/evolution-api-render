import { RouterBroker } from '@api/abstract/abstract.router';
import { AgendaSettingsDto, AppointmentCreateDto, AppointmentUpdateDto } from '@api/dto/agenda.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { authGuard } from '@api/guards/auth.guard';
import { agendaController, agendaService, googleCalendarService } from '@api/server.module';
import { GoogleCalendarError } from '@api/services/google-calendar.service';
import { agendaSettingsSchema, appointmentCreateSchema, appointmentUpdateSchema } from '@validate/validate.schema';
import { RequestHandler, Response, Router } from 'express';

import { HttpStatus } from './index.router';

const sendIcs = (res: Response, body: string) => {
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="agenda.ics"');
  res.set('Cache-Control', 'private, max-age=300');
  res.status(HttpStatus.OK).send(body);
};

/**
 * "Agenda". Instance-scoped like the other routes (global key or the token of the instance), except:
 * POST /agenda/tick (global key only, for an external cron) and GET /agenda/ics/:token.ics (public, the random
 * token of the instance is the credential; read-only).
 * Google Agenda: GET /agenda/google/callback is public (the signed, 10-minute state of the "Conectar" of an instance
 * is the credential) and always redirects back to the panel; status, connect and disconnect use the guards.
 * Static paths come first: an instance cannot be named "settings", "ics", "tick" or "google" here.
 */
export class AgendaRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    const noStore = (res: Response) => res.set('Cache-Control', 'no-store');
    this.router
      .post('/tick', authGuard['apikey'], async (_req, res) => {
        noStore(res);
        res.status(HttpStatus.OK).json(await agendaService.tick());
      })
      .get('/google/callback', async (req, res) => {
        noStore(res);
        let instanceId: string | null = googleCalendarService.instanceFromState(req.query.state);
        try {
          if (req.query.error) throw new GoogleCalendarError('A conexão foi cancelada na tela do Google.');
          instanceId = await googleCalendarService.finishConnect(req.query.code, req.query.state);
          void agendaService.syncGoogleFuture(instanceId).catch(() => undefined);
          res.redirect(302, googleCalendarService.returnTo(instanceId, 'ok'));
        } catch (error) {
          const message =
            error instanceof GoogleCalendarError ? error.message : 'Não foi possível conectar o Google Agenda agora.';
          res.redirect(302, googleCalendarService.returnTo(instanceId, 'erro', message));
        }
      })
      .get('/google/:instanceName', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => agendaController.googleStatus(instance),
        });
        noStore(res);
        res.status(HttpStatus.OK).json(response);
      })
      .post('/google/:instanceName/connect', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => agendaController.googleConnect(instance as any),
        });
        noStore(res);
        res.status(HttpStatus.OK).json(response);
      })
      .delete('/google/:instanceName', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => agendaController.googleDisconnect(instance),
        });
        noStore(res);
        res.status(HttpStatus.OK).json(response);
      })
      .get('/ics/:token.ics', async (req, res) => {
        const body = await agendaService.icsByToken(String(req.params.token ?? ''));
        if (!body) return res.status(HttpStatus.NOT_FOUND).send('Not found');
        sendIcs(res, body);
      })
      .get('/settings/:instanceName', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => agendaController.getSettings(instance),
        });
        noStore(res);
        res.status(HttpStatus.OK).json(response);
      })
      .post('/settings/:instanceName', ...guards, async (req, res) => {
        const response = await this.dataValidate<AgendaSettingsDto>({
          request: req,
          schema: agendaSettingsSchema,
          ClassRef: AgendaSettingsDto,
          execute: (instance, data) => agendaController.saveSettings(instance, data),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post('/settings/:instanceName/ics-token', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => agendaController.regenerateIcsToken(instance),
        });
        noStore(res);
        res.status(HttpStatus.OK).json(response);
      })
      .get('/:instanceName/slots', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => agendaController.slots(instance as any),
        });
        noStore(res);
        res.status(HttpStatus.OK).json(response);
      })
      .get('/:instanceName/export.ics', ...guards, async (req, res) => {
        const body = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => agendaController.ics(instance),
        });
        sendIcs(res, body);
      })
      .get('/:instanceName', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => agendaController.list(instance as any),
        });
        noStore(res);
        res.status(HttpStatus.OK).json(response);
      })
      .post('/:instanceName', ...guards, async (req, res) => {
        const response = await this.dataValidate<AppointmentCreateDto>({
          request: req,
          schema: appointmentCreateSchema,
          ClassRef: AppointmentCreateDto,
          execute: (instance, data) => agendaController.create(instance, data),
        });
        res.status(response?.created === false ? HttpStatus.OK : HttpStatus.CREATED).json(response);
      })
      .patch('/:instanceName/:id', ...guards, async (req, res) => {
        const response = await this.dataValidate<AppointmentUpdateDto>({
          request: req,
          schema: appointmentUpdateSchema,
          ClassRef: AppointmentUpdateDto,
          execute: (instance, data) => agendaController.update(instance as any, data),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .delete('/:instanceName/:id', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => agendaController.cancel(instance as any),
        });
        res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
