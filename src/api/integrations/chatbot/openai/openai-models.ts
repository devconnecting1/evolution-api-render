/**
 * Which OpenAI models work for the WhatsApp bot (Chat Completions) and how they compare.
 *
 * Source: the official model pages, pricing and deprecations (developers.openai.com/api/docs, Nov 2026).
 * The model list of the panel ("Buscar modelos") comes from the customer's key; here it is filtered to the models the
 * bot can call and each one gets a short note (price compared to gpt-6-luna, recommendation, shutdown date).
 */

export interface OpenaiModelInfo {
  /** Short note shown next to the id in the panel. */
  note: string;
  status: 'current' | 'deprecated';
  /** Shutdown date (YYYY-MM-DD) of a deprecated model. */
  shutdown?: string;
  /** Recommended replacement of a deprecated model. */
  replacement?: string;
  recommended?: boolean;
  /** Output price per 1M tokens in USD (for the comparison with gpt-6-luna). */
  outputPrice?: number;
}

const LUNA_OUTPUT = 0.5;
const times = (price: number) => `${Math.round(price / LUNA_OUTPUT)}× o preço do Luna`;

const CATALOG: Record<string, OpenaiModelInfo> = {
  'gpt-6-luna': { note: 'recomendado · o mais barato', status: 'current', recommended: true, outputPrice: 0.5 },
  'gpt-6.1-terra': { note: `rápido, escrita natural · ${times(5)}`, status: 'current', outputPrice: 5 },
  'gpt-6.1-sol': { note: `para casos complexos · ${times(10)}`, status: 'current', outputPrice: 10 },
  'gpt-6-sol': { note: times(10), status: 'current', outputPrice: 10 },
  'gpt-6-astra': { note: `o mais capaz · ${times(50)}`, status: 'current', outputPrice: 50 },
  'gpt-5.6-luna': { note: `barato · ${times(1.2)}`, status: 'current', outputPrice: 1.2 },
  'gpt-5.6-terra': { note: times(12), status: 'current', outputPrice: 12 },
  'gpt-5.6-sol': { note: times(20), status: 'current', outputPrice: 20 },
  'gpt-5.5': { note: times(30), status: 'current', outputPrice: 30 },
  'gpt-5.4': { note: times(15), status: 'current', outputPrice: 15 },
  'gpt-5.4-mini': { note: times(4.5), status: 'current', outputPrice: 4.5 },
  'gpt-5.2': { note: times(14), status: 'current', outputPrice: 14 },
  'chat-latest': { note: `muda sem aviso · ${times(30)}`, status: 'current', outputPrice: 30 },
  'gpt-5.4-nano': { note: '', status: 'deprecated', shutdown: '2027-04-01', replacement: 'gpt-6-luna' },
  'gpt-5': { note: '', status: 'deprecated', shutdown: '2026-12-11', replacement: 'gpt-6.1-sol' },
  'gpt-5-mini': { note: '', status: 'deprecated', shutdown: '2026-12-11', replacement: 'gpt-6.1-terra' },
  'gpt-5-nano': { note: '', status: 'deprecated', shutdown: '2026-12-11', replacement: 'gpt-6-luna' },
  o3: { note: '', status: 'deprecated', shutdown: '2026-12-11', replacement: 'gpt-6.1-sol' },
  'gpt-4.1': { note: '', status: 'deprecated', shutdown: '2027-01-14', replacement: 'gpt-6-luna' },
  'gpt-4.1-mini': { note: '', status: 'deprecated', shutdown: '2027-01-14', replacement: 'gpt-6-luna' },
  'gpt-4o': { note: '', status: 'deprecated', shutdown: '2027-01-14', replacement: 'gpt-6-luna' },
  'gpt-4o-mini': { note: '', status: 'deprecated', shutdown: '2027-01-14', replacement: 'gpt-6-luna' },
};

/** Model families that are not chat models, or not available in Chat Completions (the pro and cyber models). */
const NOT_CHAT =
  /(audio|realtime|tts|transcribe|whisper|image|embedding|moderation|search|codex|live|dall-e|davinci|babbage|cyber|gpt-oss|computer-use|-pro\b|instruct)/i;
/** Chat models the bot can call with Chat Completions. */
const CHAT = /^(ft:)?(gpt-[3-9]|o\d|chat-latest)/i;
const SNAPSHOT = /-\d{4}-\d{2}-\d{2}$/;

const baseId = (id: string) => (id || '').toLowerCase().replace(SNAPSHOT, '');

export function modelInfo(id: string): OpenaiModelInfo | null {
  return CATALOG[baseId(id)] ?? null;
}

/** True when the bot can use the model (chat model in Chat Completions). Fine-tuned chat models count. */
export function isBotChatModel(id: string): boolean {
  const lower = (id || '').toLowerCase();
  if (!CHAT.test(lower)) return false;
  const base = lower.startsWith('ft:') ? lower.slice(3).split(':')[0] : lower;
  return !NOT_CHAT.test(base);
}

const formatDate = (iso: string) => iso.split('-').reverse().join('/');

/** Label of the panel select: "gpt-6-luna · recomendado · o mais barato". */
export function modelLabel(id: string): string {
  const info = modelInfo(id);
  if (!info) return id;
  if (info.status === 'deprecated') {
    return (
      `${id} · descontinuado, desliga em ${formatDate(info.shutdown!)}` +
      (info.replacement ? ` (use ${info.replacement})` : '')
    );
  }
  return info.note ? `${id} · ${info.note}` : id;
}

/**
 * The list of the panel: only models the bot can call, one entry per model (dated snapshots only when their alias is
 * missing), recommended first, then current models from the cheapest, then the others, deprecated at the end.
 * Each entry keeps the OpenAI fields and gets `label`, `status` and `recommended`.
 */
export function botModelList<T extends { id: string }>(models: T[] | null | undefined) {
  const list = (models ?? []).filter((m) => m?.id && isBotChatModel(m.id));
  const ids = new Set(list.map((m) => m.id.toLowerCase()));
  const visible = list.filter((m) => !(SNAPSHOT.test(m.id) && ids.has(baseId(m.id))));
  const rank = (id: string) => {
    const info = modelInfo(id);
    if (info?.recommended) return [0, 0];
    if (info?.status === 'current') return [1, info.outputPrice ?? 999];
    if (!info) return [2, 0];
    return [3, 0];
  };
  return visible
    .map((m) => {
      const info = modelInfo(m.id);
      return {
        ...m,
        label: modelLabel(m.id),
        status: info?.status ?? 'unknown',
        recommended: !!info?.recommended,
        ...(info?.shutdown ? { shutdown: info.shutdown } : {}),
      };
    })
    .sort((a, b) => {
      const [ra, pa] = rank(a.id);
      const [rb, pb] = rank(b.id);
      return ra - rb || pa - pb || a.id.localeCompare(b.id);
    });
}
