/**
 * Safe AI context of "Processos": when a contact linked by the team to a monitored process asks about it, the
 * OpenAI bot gets a short system block with the DATES of the last updates of THAT contact's processes only
 * (never movement names, texts, deadlines or decisions: owner policy), and instructions to stay neutral and offer
 * to pass the question to the lawyer. Opt-in per process (allowAiAnswer, default false) and per instance
 * (ProcessSettings.enabled). Any failure means no block: the bot answers as before.
 */
import { dateBR } from './notify';

const TRIGGER =
  /\b(processo|processos|andamento|novidade|novidades|movimenta[cç][aã]o|movimentou|atualiza[cç][aã]o|meu caso|minha a[cç][aã]o)\b/i;

export const asksAboutProcess = (text: unknown): boolean => TRIGGER.test(String(text ?? ''));

export type AiProcessFacts = { label: string; updates: Date[] };

export function buildProcessContextBlock(facts: AiProcessFacts[]): string | null {
  const usable = facts.filter((f) => f && f.label);
  if (!usable.length) return null;
  const lines = usable.map((f) => {
    const dates = f.updates
      .slice(0, 3)
      .map((d) => dateBR(d))
      .filter(Boolean);
    return dates.length
      ? `- ${f.label}: atualizações registradas em ${dates.join(', ')}.`
      : `- ${f.label}: nenhuma atualização registrada ainda.`;
  });
  return [
    'Contexto do escritório (somente para esta conversa): processos deste cliente acompanhados pelo escritório.',
    ...lines,
    'Regras: informe apenas se houve atualização e a data, de forma neutra. Não diga o conteúdo da movimentação,',
    'não interprete, não fale de prazos, decisões, valores ou chances, e não cite outros processos ou clientes.',
    'Diga que o escritório vai analisar e ofereça encaminhar a dúvida para o advogado responsável.',
  ].join('\n');
}

export type ProcessAiContextProvider = (instanceId: string, remoteJid: string, text: string) => Promise<string | null>;

let provider: ProcessAiContextProvider | null = null;

export function setProcessAiContextProvider(fn: ProcessAiContextProvider | null): void {
  provider = fn;
}

/** Called by the OpenAI bot before each answer. Fast path (no DB) unless the text asks about a process. */
export async function getProcessAiContext(instanceId: string, remoteJid: string, text: string): Promise<string | null> {
  if (!provider || !instanceId || !remoteJid || !asksAboutProcess(text)) return null;
  try {
    return await Promise.race([
      provider(instanceId, remoteJid, text),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000).unref?.()),
    ]);
  } catch {
    return null;
  }
}
