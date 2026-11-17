/**
 * Virtual clock of the simulator: replaces setTimeout/setInterval/setImmediate-free timers and Date while a run
 * is active, so the real pipeline (debounce, typing delay, human pause, business hours) runs in simulated time.
 *
 * Determinism: timers fire one at a time, ordered by (due time, creation order); after each one every pending
 * microtask is drained (the pipeline is in memory: no I/O) before the next timer. No wall-clock time is involved.
 *
 * Real I/O (the opt-in real-model eval): `track(promise)` registers an external promise; the clock never moves while
 * one is pending. Timers created by node internals / undici / the OpenAI SDK can be sent to the real timers with
 * `realTimersFor`, so a network library never waits for simulated time.
 */
import { AsyncResource } from 'node:async_hooks';

type Timer = {
  id: number;
  at: number;
  seq: number;
  fn: () => void;
  interval: number | null;
  unref: boolean;
  cancelled: boolean;
};

const real = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setImmediate: globalThis.setImmediate,
  Date: globalThis.Date,
};

export const realSetTimeout = real.setTimeout;
export const realDate = real.Date;
export const realNow = () => real.Date.now();

/** A minimal binary heap ordered by (at, seq). */
class TimerHeap {
  private items: Timer[] = [];
  get size() {
    return this.items.length;
  }
  push(timer: Timer) {
    const items = this.items;
    items.push(timer);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(items[parent], items[i])) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  peek(): Timer | undefined {
    return this.items[0];
  }
  pop(): Timer | undefined {
    const items = this.items;
    if (!items.length) return undefined;
    const top = items[0];
    const last = items.pop() as Timer;
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(items[l], items[m])) m = l;
        if (r < items.length && this.less(items[r], items[m])) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top;
  }
  private less(a: Timer, b: Timer) {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }
}

export class VirtualClock {
  private nowMs: number;
  private seq = 0;
  private nextId = 1;
  private readonly heap = new TimerHeap();
  private readonly byId = new Map<number, Timer>();
  private readonly external = new Set<Promise<unknown>>();
  private installed = false;
  /** Timers fired so far (diagnostics). */
  fired = 0;

  constructor(
    start: Date | number,
    private readonly options: { realTimersFor?: RegExp } = {},
  ) {
    this.nowMs = typeof start === 'number' ? start : start.getTime();
  }

  now(): number {
    return this.nowMs;
  }

  /** Registers an external promise (real I/O): the clock waits for it before moving. */
  track<T>(promise: Promise<T>): Promise<T> {
    this.external.add(promise);
    const done = () => this.external.delete(promise);
    promise.then(done, done);
    return promise;
  }

  private schedule(fn: (...args: any[]) => void, delay: number, args: any[], interval: boolean): any {
    const ms = Math.max(0, Number(delay) || 0);
    const bound = AsyncResource.bind(() => fn(...args));
    const timer: Timer = {
      id: this.nextId++,
      at: this.nowMs + ms,
      seq: this.seq++,
      fn: bound,
      interval: interval ? Math.max(1, ms) : null,
      unref: false,
      cancelled: false,
    };
    this.heap.push(timer);
    this.byId.set(timer.id, timer);
    const handle: any = {
      id: timer.id,
      unref: () => {
        timer.unref = true;
        return handle;
      },
      ref: () => {
        timer.unref = false;
        return handle;
      },
      hasRef: () => !timer.unref,
      refresh: () => {
        timer.cancelled = true;
        const next = this.schedule(fn, ms, args, interval);
        handle.id = next.id;
        return handle;
      },
      [Symbol.toPrimitive]: () => handle.id,
    };
    return handle;
  }

  private cancel(handle: any) {
    if (handle == null) return;
    const id = typeof handle === 'object' ? handle.id : Number(handle);
    const timer = this.byId.get(id);
    if (timer) {
      timer.cancelled = true;
      this.byId.delete(id);
    }
  }

  private useReal(): boolean {
    if (!this.options.realTimersFor) return false;
    // Only the frame that called setTimeout (0: Error, 1: useReal, 2: the patched setTimeout): an async stack of app
    // code also ends in node:internal frames, and app timers must stay virtual
    const caller = (new Error().stack ?? '').split('\n')[3] ?? '';
    return this.options.realTimersFor.test(caller);
  }

  install(): this {
    if (this.installed) return this;
    this.installed = true;
    const now = () => this.nowMs;
    (globalThis as any).setTimeout = (fn: any, delay?: number, ...args: any[]) =>
      this.useReal() ? real.setTimeout(fn, delay, ...args) : this.schedule(fn, delay ?? 0, args, false);
    (globalThis as any).clearTimeout = (handle: any) =>
      handle && typeof handle === 'object' && 'id' in handle ? this.cancel(handle) : real.clearTimeout(handle);
    (globalThis as any).setInterval = (fn: any, delay?: number, ...args: any[]) =>
      this.useReal() ? real.setInterval(fn, delay, ...args) : this.schedule(fn, delay ?? 0, args, true);
    (globalThis as any).clearInterval = (handle: any) =>
      handle && typeof handle === 'object' && 'id' in handle ? this.cancel(handle) : real.clearInterval(handle);

    class VirtualDate extends real.Date {
      constructor(...args: any[]) {
        if (args.length === 0) super(now());
        else super(...(args as [any]));
      }
      static now() {
        return now();
      }
    }
    (globalThis as any).Date = VirtualDate;
    return this;
  }

  uninstall(): void {
    if (!this.installed) return;
    this.installed = false;
    Object.assign(globalThis, {
      setTimeout: real.setTimeout,
      clearTimeout: real.clearTimeout,
      setInterval: real.setInterval,
      clearInterval: real.clearInterval,
      Date: real.Date,
    });
  }

  /** Lets every pending microtask (and tracked external promise) finish. */
  async settle(): Promise<void> {
    for (let round = 0; round < 1000; round++) {
      await new Promise<void>((resolve) => real.setImmediate(resolve));
      if (!this.external.size) {
        await new Promise<void>((resolve) => real.setImmediate(resolve));
        if (!this.external.size) return;
      }
      if (this.external.size) await Promise.allSettled([...this.external]);
    }
  }

  /** Virtual sleep (for the simulated customers and the scenario scripts). */
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.schedule(resolve, ms, [], false));
  }

  /** Fires the next due timer. False when only unref'd timers (or none) are left. */
  private async step(limitAt: number): Promise<boolean> {
    for (;;) {
      const next = this.heap.peek();
      if (!next) return false;
      if (next.cancelled) {
        this.heap.pop();
        continue;
      }
      if (next.at > limitAt) return false;
      this.heap.pop();
      this.byId.delete(next.id);
      if (next.at > this.nowMs) this.nowMs = next.at;
      this.fired++;
      if (next.interval !== null) {
        next.at = this.nowMs + next.interval;
        next.seq = this.seq++;
        this.heap.push(next);
        this.byId.set(next.id, next);
      }
      try {
        next.fn();
      } catch {
        // a throwing timer callback must not stop the simulation (it would crash a real process instead)
      }
      await this.settle();
      return true;
    }
  }

  /**
   * Runs the simulation until `done()` is true (checked after each timer) or nothing referenced is left.
   * `maxVirtualMs` stops a runaway scenario.
   */
  async runUntil(done: () => boolean, maxVirtualMs = 120 * 24 * 3600 * 1000): Promise<void> {
    const limit = this.nowMs + maxVirtualMs;
    await this.settle();
    while (!done()) {
      if (!this.hasReferencedTimers()) break;
      if (!(await this.step(limit))) break;
    }
  }

  private hasReferencedTimers(): boolean {
    for (const timer of this.byId.values()) if (!timer.cancelled && !timer.unref) return true;
    return false;
  }
}
