/**
 * Load test: N contacts write at the same moment, each a burst of quick messages (plus a redelivered duplicate),
 * then a second turn after the first answer. With an echo model that repeats the protocol code of each contact,
 * it verifies: exactly one answer per customer turn, every answer goes to the right contact and only mentions
 * that contact's own code (no cross-talk between debounce windows, sessions or reply tickets).
 */
import { realNow, VirtualClock } from './clock';
import { SIM_EPOCH } from './conversation';
import { rng } from './matrix';
import { createScriptedModel } from './scripted-model';
import { World } from './world';

export type BurstReport = {
  contacts: number;
  turns: number;
  expectedReplies: number;
  replies: number;
  missing: number;
  extra: number;
  crossTalk: number;
  wrongAddress: number;
  merged: number;
  virtualSeconds: number;
  wallMs: number;
  examples: string[];
};

export async function runBurst(contacts = 1000, seed = 7): Promise<BurstReport> {
  const started = realNow();
  const clock = new VirtualClock(SIM_EPOCH + 10 * 3600 * 1000).install();
  try {
    const world = new World(clock, createScriptedModel({ echo: true }));
    const office = await world.addInstance({ handoffTool: false, hoursMode: 'always' });
    const random = rng(seed);
    const code = (i: number, turn: number) => `PROTO-${i.toString(36).toUpperCase()}T${turn}`;
    const jidOf = (i: number) => `550097${String(i).padStart(7, '0')}@s.whatsapp.net`; // area code 00: fictitious
    const examples: string[] = [];
    let pending = contacts;

    const play = async (i: number) => {
      const jid = jidOf(i);
      for (let turn = 1; turn <= 2; turn++) {
        // 3 quick messages (0–4 s apart, inside the 8 s debounce), the second one redelivered by WhatsApp
        const parts = [`oi ${code(i, turn)}`, `segunda parte ${code(i, turn)}`, `fim ${code(i, turn)}`];
        let duplicate: any = null;
        for (let p = 0; p < parts.length; p++) {
          const msg = {
            key: { id: world.nextMessageId(), remoteJid: jid, fromMe: false },
            pushName: 'Contato',
            message: { conversation: parts[p] },
            messageType: 'conversation',
          };
          await world.receive(office, jid, msg, { kind: 'text' });
          if (p === 1) duplicate = structuredClone(msg);
          await clock.sleep(random.int(1500) + 500);
        }
        await world.receive(office, jid, duplicate, { kind: 'duplicate' });
        // Wait for the answer of this turn before the next one
        const before = turn - 1;
        const deadline = clock.now() + 120_000;
        while (
          clock.now() < deadline &&
          world.transcript(office, jid).filter((e) => e.who === 'bot').length <= before
        ) {
          await clock.sleep(1000);
        }
        await clock.sleep(20_000 + random.int(20_000));
      }
    };

    for (let i = 0; i < contacts; i++) void play(i).finally(() => void pending--);
    await clock.runUntil(() => pending === 0);
    await world.idle();
    await clock.runUntil(() => false, 60_000);

    let replies = 0;
    let missing = 0;
    let extra = 0;
    let crossTalk = 0;
    for (let i = 0; i < contacts; i++) {
      const bot = world.transcript(office, jidOf(i)).filter((event) => event.who === 'bot');
      replies += bot.length;
      if (bot.length < 2) missing += 2 - bot.length;
      if (bot.length > 2) extra += bot.length - 2;
      bot.forEach((reply, index) => {
        const codes: string[] = reply.text.match(/PROTO-[A-Z0-9]+/g) ?? [];
        const own = code(i, index + 1);
        if (codes.some((c) => c !== own) || !codes.includes(own)) {
          crossTalk++;
          if (examples.length < 5) examples.push(`contato ${i}, turno ${index + 1}: "${reply.text}"`);
        }
      });
    }
    const known = new Set(Array.from({ length: contacts }, (_, i) => jidOf(i)));
    const wrongAddress = world.sends.filter((send) => !known.has(send.jid)).length;
    return {
      contacts,
      turns: 2,
      expectedReplies: contacts * 2,
      replies,
      missing,
      extra,
      crossTalk,
      wrongAddress,
      merged: world.controller.mergedReplies ?? 0,
      virtualSeconds: (clock.now() - (SIM_EPOCH + 10 * 3600 * 1000)) / 1000,
      wallMs: realNow() - started,
      examples,
    };
  } finally {
    clock.uninstall();
  }
}

export const burstPassed = (report: BurstReport) =>
  report.missing === 0 && report.extra === 0 && report.crossTalk === 0 && report.wrongAddress === 0;
