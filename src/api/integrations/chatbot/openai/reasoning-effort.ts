/**
 * Reasoning effort of the OpenAI models (Chat Completions `reasoning_effort`).
 *
 * Levels and defaults come from the official model pages (developers.openai.com/api/docs/models, Nov 2026):
 * - gpt-6-luna, gpt-6-sol: none, low, medium (default), high, xhigh, max.
 * - gpt-5.6-* (luna, terra, sol): the same levels.
 * - gpt-6-astra, gpt-6.1-sol: low, medium (default), high, xhigh, max (no `none`: HTTP 400).
 * - gpt-6.1-terra: none, low, medium (default), high, xhigh, max.
 * - gpt-5.5: none, low, medium (default), high, xhigh.
 * - gpt-5.4 (mini, nano): none (default), low, medium, high, xhigh.
 * - gpt-5.2: none (default), low, medium, high, xhigh. gpt-5.1: none (default), low, medium, high.
 * - gpt-5 (mini, nano): minimal, low, medium (default), high.
 * - o-series (o1, o3, o4-mini): low, medium (default), high.
 * Function calling in Chat Completions (measured with the API, 18/11/2026): gpt-6-luna, gpt-6-sol, gpt-6.1-terra,
 * gpt-5.6-*, gpt-5.5 and gpt-5.4 only accept tools with `none` (any other level, or the parameter left out on a
 * model whose default is not `none`, is a 400 "Function tools with reasoning_effort are not supported"), so a
 * request with tools always goes with `none`. gpt-5.2, gpt-5.1, gpt-5 and the o-series accept tools at any level.
 * gpt-6-astra and gpt-6.1-sol do not accept tools in Chat Completions at all (the bot answers without them).
 * Models without reasoning (gpt-4o, gpt-4.1...) never get the parameter.
 *
 * The bot stores `null` for "automatic": the model's own default, except a request with tools on a model that only
 * accepts tools with `none`. A value the model does not support is moved to the closest supported level, and a
 * model that still rejects the parameter (400) is remembered and called without it.
 */

export const REASONING_EFFORT_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffortLevel = (typeof REASONING_EFFORT_LEVELS)[number];
/** What the bot accepts: 'auto' (stored as null) or one of the levels. */
export const REASONING_EFFORT_OPTIONS = ['auto', ...REASONING_EFFORT_LEVELS] as const;
export type ReasoningEffortOption = (typeof REASONING_EFFORT_OPTIONS)[number];

export interface ReasoningProfile {
  /** Levels the model accepts, from the lowest to the highest. */
  levels: ReasoningEffortLevel[];
  /** Level the model uses when the parameter is not sent. */
  defaultLevel: ReasoningEffortLevel;
  /** Chat Completions accepts function calling only with `none` (gpt-6-luna/sol, gpt-6.1-terra, 5.6, 5.5, 5.4). */
  toolsOnlyWithNone: boolean;
}

const ALL: ReasoningEffortLevel[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
const NO_NONE: ReasoningEffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const UP_TO_XHIGH: ReasoningEffortLevel[] = ['none', 'low', 'medium', 'high', 'xhigh'];
const UP_TO_HIGH: ReasoningEffortLevel[] = ['none', 'low', 'medium', 'high'];
const GPT5: ReasoningEffortLevel[] = ['minimal', 'low', 'medium', 'high'];
const O_SERIES: ReasoningEffortLevel[] = ['low', 'medium', 'high'];

/** Model id without the fine-tune prefix and the date snapshot ("ft:gpt-5.4-mini-2026-03-17:org::id" -> "gpt-5.4-mini"). */
function baseModel(model: string): string {
  let id = (model || '').trim().toLowerCase();
  if (id.startsWith('ft:')) id = id.slice(3).split(':')[0];
  return id.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

/** The reasoning profile of a model, or null when the model has no reasoning (never send the parameter). */
export function reasoningProfile(model: string | null | undefined): ReasoningProfile | null {
  const id = baseModel(model || '');
  if (!id) return null;
  const profile = (levels: ReasoningEffortLevel[], defaultLevel: ReasoningEffortLevel, toolsOnlyWithNone = false) => ({
    levels,
    defaultLevel,
    toolsOnlyWithNone,
  });

  if (/^gpt-6\.1-sol\b/.test(id) || /^gpt-6(\.\d+)?-astra\b/.test(id)) return profile(NO_NONE, 'medium');
  if (/^gpt-6\.1-terra\b/.test(id)) return profile(ALL, 'medium', true);
  if (/^gpt-6(\.0)?-(luna|sol)\b/.test(id)) return profile(ALL, 'medium', true);
  if (/^gpt-5\.6-/.test(id)) return profile(ALL, 'medium', true);
  // Other gpt-6 variants not listed above: the levels every reasoning model accepts
  if (/^gpt-6/.test(id)) return profile(O_SERIES, 'medium');
  if (/^gpt-5(\.\d+)?-pro\b/.test(id)) return profile(['high'], 'high');
  if (/^gpt-5\.5\b/.test(id)) return profile(UP_TO_XHIGH, 'medium', true);
  if (/^gpt-5\.4\b/.test(id)) return profile(UP_TO_XHIGH, 'none', true);
  if (/^gpt-5\.2\b/.test(id)) return profile(UP_TO_XHIGH, 'none');
  if (/^gpt-5\.[13]\b/.test(id)) return profile(UP_TO_HIGH, 'none');
  if (/^gpt-5-chat\b/.test(id)) return null;
  if (/^gpt-5(-mini|-nano)?$/.test(id) || /^gpt-5-(mini|nano)\b/.test(id)) return profile(GPT5, 'medium');
  if (/^o[134](-mini|-pro)?\b/.test(id)) return profile(O_SERIES, 'medium');
  return null;
}

/** 'auto', null and unknown values mean "automatic" (null); valid levels are kept. */
export function normalizeReasoningEffort(value: unknown): ReasoningEffortLevel | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return (REASONING_EFFORT_LEVELS as readonly string[]).includes(v) ? (v as ReasoningEffortLevel) : null;
}

/** The supported level closest to the wanted one (ties go to the higher level: `minimal` -> `low`). */
export function closestSupportedLevel(
  wanted: ReasoningEffortLevel,
  levels: ReasoningEffortLevel[],
): ReasoningEffortLevel {
  if (levels.includes(wanted)) return wanted;
  const rank = (level: ReasoningEffortLevel) => REASONING_EFFORT_LEVELS.indexOf(level);
  let best = levels[0];
  for (const level of levels) {
    const d = Math.abs(rank(level) - rank(wanted));
    const bestD = Math.abs(rank(best) - rank(wanted));
    if (d < bestD || (d === bestD && rank(level) > rank(best))) best = level;
  }
  return best;
}

export interface ResolvedReasoningEffort {
  /** Value sent as `reasoning_effort`, or undefined to leave the parameter out. */
  send?: ReasoningEffortLevel;
  /** Level that really applies (sent or the model default); null for models without reasoning. */
  effective: ReasoningEffortLevel | null;
  /** Why the configured level was changed ('unsupported' or 'tools'). */
  adjusted?: 'unsupported' | 'tools';
}

/**
 * What to send for one request. `configured` is the bot value (null = automatic); `withTools` is true when the
 * request offers tools (agenda, handoff).
 */
export function resolveReasoningEffort(
  model: string | null | undefined,
  configured: unknown,
  withTools = false,
): ResolvedReasoningEffort {
  const profile = reasoningProfile(model);
  if (!profile) return { effective: null };

  const wanted = normalizeReasoningEffort(configured);
  if (withTools && profile.toolsOnlyWithNone) {
    const adjusted = (wanted ?? profile.defaultLevel) !== 'none' ? 'tools' : undefined;
    return { send: 'none', effective: 'none', ...(adjusted ? { adjusted } : {}) };
  }
  if (!wanted) return { effective: profile.defaultLevel };

  const level = closestSupportedLevel(wanted, profile.levels);
  return { send: level, effective: level, ...(level !== wanted ? { adjusted: 'unsupported' as const } : {}) };
}

/**
 * A 400 of OpenAI refusing tools together with a reasoning level ("Function tools with reasoning_effort are not
 * supported for <model> in /v1/chat/completions ... set reasoning_effort to 'none'"). The model takes both, just
 * not at the same time: the request is retried with `none`, never without the parameter (the default level would
 * be refused again) and never by switching reasoning off for the model.
 */
export function isToolsWithReasoningError(error: any): boolean {
  const status = error?.status ?? error?.response?.status;
  if (status !== 400) return false;
  const body = error?.error ?? error?.response?.data?.error ?? {};
  const message = String(error?.message ?? body?.message ?? '');
  return /function tools?|\btools?\b/i.test(message) && /reasoning[_.]?effort/i.test(message);
}

/** A 400 of OpenAI about the reasoning_effort parameter (unsupported parameter or value). */
export function isReasoningEffortError(error: any): boolean {
  const status = error?.status ?? error?.response?.status;
  if (status !== 400) return false;
  const body = error?.error ?? error?.response?.data?.error ?? {};
  const param = String(error?.param ?? body?.param ?? '');
  if (/reasoning/i.test(param)) return true;
  const message = String(error?.message ?? body?.message ?? '');
  return /reasoning[_.]?effort/i.test(message);
}
