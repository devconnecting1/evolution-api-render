import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
import { openaiHealthService, prismaRepository } from '@api/server.module';
import { NotFoundException } from '@exceptions';
import { RequestHandler, Response, Router } from 'express';

/**
 * Saúde das chaves OpenAI da instância (global key or the token of the instance, like the other routes):
 *   GET  /openai-health/:instanceName       situação de cada credencial (memória: respostas reais e testes)
 *   POST /openai-health/:instanceName/test  testa agora: chave válida? modelo liberado? tem crédito?
 *                                           (custo ~US$ 0,00000002; no máximo 1 teste por chave a cada 30 s)
 * The key itself never leaves the server: only a masked form (sk-…WXYZ).
 */
export class OpenaiHealthRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    const noStore = (res: Response) => res.set('Cache-Control', 'no-store');
    const instanceOf = async (instance: InstanceDto) => {
      const row = await prismaRepository.instance.findUnique({
        where: { name: instance.instanceName },
        select: { id: true, name: true },
      });
      if (!row) throw new NotFoundException(`A instância "${instance.instanceName}" não existe.`);
      return row;
    };

    this.router
      .get('/:instanceName', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: async (instance) => {
            const row = await instanceOf(instance);
            return { instance: row.name, credentials: await openaiHealthService.overview([row.id]) };
          },
        });
        noStore(res);
        res.status(200).json(response);
      })
      .post('/:instanceName/test', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: async (instance) => {
            const row = await instanceOf(instance);
            const credsId = typeof req.query.credsId === 'string' ? req.query.credsId : undefined;
            return { instance: row.name, credentials: await openaiHealthService.test(row.id, credsId) };
          },
        });
        noStore(res);
        res.status(200).json(response);
      });
  }

  public readonly router: Router = Router();
}
