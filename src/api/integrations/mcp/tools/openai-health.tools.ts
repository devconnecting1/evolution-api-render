import { z } from 'zod';

import { resolveInstance } from '../mcp.instance';
import { defineTool } from '../mcp.tool';
import { jsonResult, McpToolError } from '../mcp.util';

/**
 * Saúde das chaves OpenAI: funcionando, sem crédito, chave inválida, modelo indisponível... sem entrar na conta OpenAI
 * do cliente. A chave nunca sai do servidor (só mascarada).
 */
export const getOpenaiHealth = defineTool({
  name: 'get_openai_health',
  title: 'Chaves OpenAI: funcionando ou sem crédito',
  description:
    'Mostra, por credencial OpenAI, se a chave do cliente está funcionando, sem crédito, inválida ou com o modelo indisponível, com o que fazer. Vem das respostas reais do bot (custo zero). Com test=true testa agora (chave válida? modelo liberado? tem crédito?; custo ~US$ 0,00000002, no máximo 1 vez a cada 30 s por chave). Sem instance e com a chave global, lista todas as instâncias. O saldo em dólares não é exposto pela OpenAI para chaves comuns.',
  input: {
    instance: z.string().min(1).max(255).optional().describe('Nome da instância. Sem ele (chave global): todas.'),
    test: z.boolean().optional().describe('Testar agora (padrão: não).'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  run: async ({ instance, test }, ctx) => {
    const svc = ctx.deps.openaiHealth;
    if (!svc) throw new McpToolError('a verificação das chaves OpenAI não está disponível neste servidor.');
    if (!instance && ctx.auth.scope === 'global' && !test) {
      const credentials = await svc.overview();
      return jsonResult({ total: credentials.length, credentials });
    }
    const resolved = await resolveInstance(ctx, instance);
    const credentials = test ? await svc.test(resolved.id) : await svc.overview([resolved.id]);
    return jsonResult({
      instance: resolved.name,
      tested: !!test,
      credentials,
      hint: credentials.length ? undefined : 'Esta instância não tem credencial OpenAI cadastrada.',
    });
  },
});

export const openaiHealthTools = [getOpenaiHealth];
