/**
 * Preenche Message.sentBy nas mensagens antigas (quem escreveu: cliente, celular, IA). Só o que dá para provar:
 * src/utils/message-sender-backfill.ts. Por padrão só conta (simulação); `--apply` grava.
 *
 *   DATABASE_PROVIDER=postgresql DATABASE_CONNECTION_URI='postgresql://...' \
 *     npx tsx scripts/backfill-message-sender.ts [--instance <Instance.id>] [--apply]
 *
 * Usa só a URL informada: uma instância com "Banco próprio" roda com a URL do banco dela.
 * Nunca rode contra produção sem o OK do dono (e sempre a simulação primeiro).
 */
import { createPrismaAdapter } from '../src/api/repository/prisma-adapter';
import { backfillMessageSender, formatBackfillReport } from '../src/utils/message-sender-backfill';
import { PrismaClient } from '@prisma/client';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const at = args.indexOf('--instance');
  const instanceId = at >= 0 ? args[at + 1] : null;
  const provider = process.env.DATABASE_PROVIDER || 'postgresql';
  const url = process.env.DATABASE_CONNECTION_URI;
  if (!url) {
    console.error('Defina DATABASE_CONNECTION_URI (a URL não é impressa).');
    process.exit(1);
  }
  if (at >= 0 && !instanceId) {
    console.error('--instance precisa do Instance.id.');
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: createPrismaAdapter(provider, url) });
  try {
    const result = await backfillMessageSender(prisma, {
      apply,
      instanceId,
      log: (line) => process.stderr.write(`\r${line}`),
    });
    process.stderr.write('\n');
    console.log(formatBackfillReport(result, apply));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`Falhou: ${error?.message ?? error}`);
  process.exit(1);
});
