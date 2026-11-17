/**
 * One bot reply in progress for one chat (debounce fired → model → typing delay → send).
 *
 * The debounce merges the messages typed inside its window, but the reply that follows takes time (OpenAI call
 * plus the typing delay). A customer message that arrives in that time used to open a new window and get a
 * second, separate answer ("double reply"). Now the new message cancels the reply that has not been sent yet and
 * is merged with it, so the customer gets a single answer covering everything (see ChatbotController).
 *
 * The ticket travels with the reply through AsyncLocalStorage, so the services do not need new parameters:
 * - the sender calls `tryCommit()` right before the first WhatsApp message goes out: once committed the reply
 *   can no longer be cancelled (the remaining parts follow and the new message gets its own reply after it);
 * - a cancelled reply sends nothing and runs its rollbacks (e.g. the conversation history saved for it).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type ReplyMeta = {
  /** "Click-to-WhatsApp" ad of any message of the burst (see openai/ai-context.ts). */
  adReferral?: { title?: string; body?: string; sourceUrl?: string; sourceType?: string } | null;
};

export class ReplyCancelledError extends Error {
  constructor(message = 'reply cancelled: a newer customer message will be answered together') {
    super(message);
    this.name = 'ReplyCancelledError';
  }
}

export class ReplyTicket {
  private state: 'open' | 'committed' | 'cancelled' = 'open';
  private readonly rollbacks: (() => Promise<void> | void)[] = [];

  constructor(public readonly meta: ReplyMeta = {}) {}

  get cancelled(): boolean {
    return this.state === 'cancelled';
  }

  get committed(): boolean {
    return this.state === 'committed';
  }

  /** Called before the first message is sent. False: cancelled, send nothing. */
  tryCommit(): boolean {
    if (this.state === 'cancelled') return false;
    this.state = 'committed';
    return true;
  }

  /** Called when a newer customer message arrives. False: already sending (too late to merge). */
  cancel(): boolean {
    if (this.state === 'committed') return false;
    this.state = 'cancelled';
    return true;
  }

  /** Throws ReplyCancelledError when cancelled (checkpoint between the slow steps of a reply). */
  throwIfCancelled(): void {
    if (this.cancelled) throw new ReplyCancelledError();
  }

  /** Something to undo if this reply ends up cancelled before sending (e.g. restore the saved history). */
  onRollback(task: () => Promise<void> | void): void {
    this.rollbacks.push(task);
  }

  async rollback(): Promise<void> {
    while (this.rollbacks.length) {
      const task = this.rollbacks.pop();
      try {
        await task?.();
      } catch {
        // best effort: a failed rollback must never break the next reply
      }
    }
  }
}

const storage = new AsyncLocalStorage<ReplyTicket>();

/** The reply ticket of the current async flow (null outside a coordinated reply, e.g. debounce off). */
export const currentReplyTicket = (): ReplyTicket | null => storage.getStore() ?? null;

export const runWithReplyTicket = <T>(ticket: ReplyTicket, task: () => T): T => storage.run(ticket, task);

/** Merges the meta of two messages of the same burst: the first ad referral wins. */
export const mergeReplyMeta = (base: ReplyMeta | undefined, extra: ReplyMeta | undefined): ReplyMeta => ({
  ...(base ?? {}),
  adReferral: base?.adReferral ?? extra?.adReferral ?? null,
});
