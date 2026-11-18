/**
 * The 1,000+ conversation matrix suite: builds the cases (pairwise + seeded fill), plays the cases of one shard
 * concurrently on the virtual clock, and checks every transcript.
 */
import { replyGuardStats, resetReplyGuardStats } from '@api/integrations/chatbot/openai/reply-guard';

import { checkConversation, ConversationCheck } from './checks';
import { VirtualClock } from './clock';
import { ConversationResult, personaOf, playConversation, SIM_EPOCH } from './conversation';
import { buildCases, SimCase } from './matrix';
import { flawCounts, modelStats } from './scripted-model';
import { World } from './world';

export type CompactCheck = Omit<ConversationCheck, 'replies'> & {
  replies: { text: string; kind: string }[];
  transcript: string[];
  case: SimCase;
};

/** Office of a case: 3 of 4 cases on the office with the hand-over tool and AI only inside business hours. */
export const officeIndexOf = (item: SimCase) => (item.index % 4 === 3 ? 1 : 0);

export function compact(check: ConversationCheck, world: World, result: ConversationResult): CompactCheck {
  const transcript = world
    .transcript(result.office, result.chatJid)
    .map(
      (event) =>
        `${event.who === 'bot' ? 'IA' : event.who === 'team' ? 'Equipe' : 'Cliente'}${event.delivered === false ? ' (não entregue)' : ''}: ${event.text.replace(/\s+/g, ' ').slice(0, 1200)}`,
    );
  return {
    ...check,
    replies: check.replies.map((reply) => ({ text: reply.text, kind: reply.kind })),
    transcript,
    case: result.case,
  };
}

export async function runMatrixShard(options: {
  count: number;
  seed: number;
  shard: number;
  shards: number;
  /** The model client, or a factory that gets the virtual clock (real-model eval). */
  model?: any;
  createModel?: (clock: VirtualClock) => any;
  world?: { apiKey?: string; model?: string; realModel?: boolean };
  realTimersFor?: RegExp;
  limit?: number;
  /** Only these case indices (eval sample). */
  only?: Set<number>;
}) {
  const all = buildCases(options.count, options.seed);
  let cases = all.filter((item) => item.index % options.shards === options.shard);
  if (options.only) cases = cases.filter((item) => options.only!.has(item.index));
  if (options.limit) cases = cases.slice(0, options.limit);

  resetReplyGuardStats();
  const clock = new VirtualClock(SIM_EPOCH, { realTimersFor: options.realTimersFor }).install();
  try {
    const world = new World(clock, options.createModel ? options.createModel(clock) : options.model, options.world);
    await world.addInstance({ handoffTool: true, hoursMode: 'inside' });
    await world.addInstance({ handoffTool: false, hoursMode: 'always' });

    const results: ConversationResult[] = [];
    let pending = cases.length;
    const errors: string[] = [];
    for (const item of cases) {
      playConversation(world, item, world.instances[officeIndexOf(item)])
        .then((result) => void results.push(result))
        .catch((error) => void errors.push(`#${item.index}: ${error?.stack ?? error}`))
        .finally(() => void pending--);
    }
    await clock.runUntil(() => pending === 0);
    await world.idle();
    if (pending) errors.push(`${pending} conversation(s) did not finish`);

    const allPhones = all.map((item) => personaOf(item, officeIndexOf(item)).phone);
    const allNames = [...new Set(all.map((item) => personaOf(item, officeIndexOf(item)).name))];
    results.sort((a, b) => a.case.index - b.case.index);
    const checks = results.map((result) =>
      compact(checkConversation(world, result, allPhones, allNames), world, result),
    );
    return {
      checks,
      errors,
      guard: { ...replyGuardStats },
      model: { ...modelStats, flaws: { ...flawCounts } },
      mergedReplies: world.controller.mergedReplies ?? 0,
      virtualHours: (clock.now() - SIM_EPOCH) / 3_600_000,
      timersFired: clock.fired,
    };
  } finally {
    clock.uninstall();
  }
}
