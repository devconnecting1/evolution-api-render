/**
 * Simulator of 1,000+ WhatsApp customers for the OpenAI triage bot.
 *
 *   npm run test:sim                         # matrix (1,200) + golden + 1,000-contact burst, in parallel processes
 *   npm run test:sim -- --count 300          # smaller matrix
 *   npm run test:sim -- --baseline old.json  # "what changed" section against a previous report
 *   npm run test:sim -- --real-model ...     # opt-in eval with the real OpenAI API + LLM judge (ai-eval workflow)
 *
 * Output: <out>/report.json and <out>/report.md (also appended to $GITHUB_STEP_SUMMARY). Exit code 1 when a hard
 * gate fails, a golden conversation fails, the burst loses/duplicates/mixes a reply, or a metric crosses its floor.
 * Deterministic: same seed, same code = same report (the clock is virtual, the model is scripted).
 */
import '../helpers/setup';

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { burstPassed, runBurst } from './burst';
import { aggregateMetrics, HARD_GATES, metricViolations, Threshold } from './checks';
import { VirtualClock } from './clock';
import { runGolden } from './golden';
import { buildCases, coverage } from './matrix';
import { CompactCheck, runMatrixShard } from './matrix-suite';
import { createRealModelFactory, judgeAll, REAL_TIMER_CALLERS, realModelStats, ReasoningEffort } from './real-model';
import { renderMarkdown, SimReport } from './report';
import { createScriptedModel } from './scripted-model';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback?: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};

const COUNT = Number(option('count', '1200'));
const SEED = Number(option('seed', '20261117'));
const OUT = resolve(option('out', 'sim-report')!);
const THRESHOLDS: Record<string, Threshold> = JSON.parse(
  readFileSync(join(__dirname, 'thresholds.json'), 'utf8'),
  (key, value) => (key === '$comment' ? undefined : value),
);

const readJson = (path?: string) => {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------------------------------------ parts (child)

async function runPart(part: string, jsonPath: string) {
  let data: any;
  if (part === 'matrix') {
    data = await runMatrixShard({
      count: COUNT,
      seed: SEED,
      shard: Number(option('shard', '0')),
      shards: Number(option('shards', '1')),
      model: createScriptedModel(),
    });
  } else if (part === 'golden') {
    data = await runGolden(createScriptedModel());
  } else if (part === 'burst') {
    data = await runBurst(Number(option('contacts', '1000')));
  } else {
    throw new Error(`unknown part ${part}`);
  }
  writeFileSync(jsonPath, JSON.stringify(data));
}

function spawnPart(part: string, jsonPath: string, extra: string[] = []) {
  return new Promise<void>((done, fail) => {
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        __filename,
        '--part',
        part,
        '--json',
        jsonPath,
        '--count',
        String(COUNT),
        '--seed',
        String(SEED),
        ...extra,
      ],
      { stdio: ['ignore', 'inherit', 'inherit'], env: process.env },
    );
    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`${part} ${extra.join(' ')} exited with ${code}`)),
    );
  });
}

// ------------------------------------------------------------------------------------------------ report

function worstOf(checks: CompactCheck[], limit = 6) {
  const failing = checks
    .filter((check) => check.failures.length)
    .sort((a, b) => b.failures.length - a.failures.length)
    .slice(0, limit)
    .map((check) => ({
      id: check.id,
      reason: [...new Set(check.failures.map((failure) => failure.gate))].join(', '),
      transcript: check.transcript.slice(0, 12),
    }));
  if (failing.length >= limit) return failing;
  const weak = checks
    .filter((check) => !check.failures.length && check.completeness !== null)
    .sort((a, b) => (a.completeness ?? 1) - (b.completeness ?? 1) || b.replies.length - a.replies.length)
    .slice(0, limit - failing.length)
    .map((check) => ({
      id: check.id,
      reason: `triagem ${Math.round((check.completeness ?? 0) * 100)}% completa`,
      transcript: check.transcript.slice(0, 12),
    }));
  return [...failing, ...weak];
}

function buildReport(options: {
  checks: CompactCheck[];
  golden: { results: any[]; errors: string[] } | null;
  burst: any;
  guard: Record<string, number>;
  model: Record<string, any>;
  errors: string[];
  shards: number;
  cases: ReturnType<typeof buildCases>;
}): SimReport {
  const { checks } = options;
  const gates: Record<string, number> = Object.fromEntries(HARD_GATES.map((gate) => [gate, 0]));
  const golden = options.golden?.results ?? [];
  const failures = [...checks.flatMap((check) => check.failures), ...golden.flatMap((result) => result.failures)];
  for (const failure of failures) gates[failure.gate] = (gates[failure.gate] ?? 0) + 1;
  const metrics = aggregateMetrics(checks as any);
  const violations = metricViolations(metrics, THRESHOLDS);
  const cov = coverage(options.cases);
  const goldenFailed = golden
    .filter((result) => !result.passed)
    .map((result) => ({
      id: result.id,
      title: result.title,
      problems: [...result.problems, ...result.failures.map((f: any) => `${f.gate}: ${f.detail}`)],
    }));
  const errors = [...options.errors, ...(options.golden?.errors ?? [])];
  const burstOk = !options.burst || burstPassed(options.burst);
  const passed =
    failures.length === 0 &&
    !violations.length &&
    !goldenFailed.length &&
    burstOk &&
    !errors.length &&
    checks.length > 0;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    config: { count: options.cases.length, seed: SEED, shards: options.shards },
    coverage: { perDimension: cov.perDimension, pairs: cov.pairs },
    gates,
    gateExamples: failures.slice(0, 25),
    metrics,
    thresholds: THRESHOLDS,
    metricViolations: violations,
    golden: { total: golden.length, passed: golden.length - goldenFailed.length, failed: goldenFailed },
    burst: options.burst,
    guard: options.guard,
    model: options.model,
    worst: worstOf(checks),
    errors,
    passed,
  };
}

function writeReport(report: SimReport, baseline: SimReport | null) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const markdown = renderMarkdown(report, baseline);
  writeFileSync(join(OUT, 'report.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  const gateTotal = Object.values(report.gates).reduce((a, b) => a + b, 0);
  console.log(
    `\n${report.passed ? 'PASSED' : 'FAILED'}: ${report.metrics.conversations} conversas, ${gateTotal} falhas de trava, ` +
      `referência ${report.golden.passed}/${report.golden.total}, métricas fora do limite: ${report.metricViolations.length}` +
      (report.burst ? `, carga ${report.burst.replies}/${report.burst.expectedReplies}` : '') +
      `\nRelatório: ${join(OUT, 'report.md')}`,
  );
}

const sum = (items: Record<string, number>[]) => {
  const total: Record<string, number> = {};
  for (const item of items)
    for (const [key, value] of Object.entries(item))
      if (typeof value === 'number') total[key] = (total[key] ?? 0) + value;
  return total;
};

// ------------------------------------------------------------------------------------------------ main (CI)

async function runAll() {
  const started = Date.now();
  // A fixed number of shards: the report must not depend on the machine
  const shards = Number(option('shards', '4'));
  const parts = join(OUT, 'parts');
  mkdirSync(parts, { recursive: true });
  const jobs = [
    ...Array.from({ length: shards }, (_, shard) =>
      spawnPart('matrix', join(parts, `matrix-${shard}.json`), ['--shard', String(shard), '--shards', String(shards)]),
    ),
    spawnPart('golden', join(parts, 'golden.json')),
    spawnPart('burst', join(parts, 'burst.json'), ['--contacts', option('contacts', '1000')!]),
  ];
  const errors: string[] = [];
  for (const result of await Promise.allSettled(jobs)) {
    if (result.status === 'rejected') errors.push(String(result.reason?.message ?? result.reason));
  }
  const shardData = Array.from({ length: shards }, (_, shard) => readJson(join(parts, `matrix-${shard}.json`))).filter(
    Boolean,
  );
  const checks: CompactCheck[] = shardData.flatMap((data) => data.checks).sort((a, b) => a.case.index - b.case.index);
  const report = buildReport({
    checks,
    golden: readJson(join(parts, 'golden.json')),
    burst: readJson(join(parts, 'burst.json')),
    guard: sum(shardData.map((data) => data.guard)),
    model: sum(shardData.map((data) => ({ ...data.model, flaws: undefined }))),
    errors: [...errors, ...shardData.flatMap((data) => data.errors)],
    shards,
    cases: buildCases(COUNT, SEED),
  });
  const baseline = readJson(option('baseline'));
  writeReport(report, baseline);
  console.log(`Tempo total: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return report.passed;
}

// ------------------------------------------------------------------------------------------------ real model (eval)

async function runEval() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY não definido: a avaliação com o modelo real precisa da chave.');
    return false;
  }
  const botModel = option('bot-model', 'gpt-6-luna')!;
  const judgeModel = option('judge-model', 'gpt-6.1-terra')!;
  const effort = (option('reasoning-effort', 'high') || null) as ReasoningEffort | null;
  const sample = Number(option('sample', '60'));
  const all = buildCases(COUNT, SEED);
  // An even spread over the pairwise part of the matrix (every dimension value shows up)
  const step = Math.max(1, Math.floor(Math.min(all.length, 338) / sample));
  const chosen = new Set(
    all
      .filter((item) => item.index % step === 0)
      .slice(0, sample)
      .map((item) => item.index),
  );

  const createModel = (clock: VirtualClock) =>
    createRealModelFactory({ clock, reasoningEffort: effort, maxConcurrent: 6 });
  const world = { apiKey, model: botModel, realModel: true };
  const matrix = await runMatrixShard({
    count: COUNT,
    seed: SEED,
    shard: 0,
    shards: 1,
    createModel,
    world,
    realTimersFor: REAL_TIMER_CALLERS,
    only: chosen,
  }).catch((error) => ({
    checks: [] as CompactCheck[],
    errors: [String(error?.stack ?? error)],
    guard: {},
    model: {},
  }));
  const checks: CompactCheck[] = (matrix.checks as CompactCheck[]).filter((check) => chosen.has(check.case.index));
  const golden = flag('skip-golden')
    ? null
    : await runGolden(null, { realTimersFor: REAL_TIMER_CALLERS, world, createModel });

  const conversations = [
    ...checks.map((check) => ({ id: check.id, transcript: check.transcript, failures: check.failures.length })),
    ...(golden?.results ?? []).map((result) => ({
      id: result.id,
      transcript: result.transcript,
      failures: result.failures.length,
    })),
  ];
  const judge = await judgeAll(apiKey, judgeModel, conversations);
  const report = buildReport({
    checks,
    golden,
    burst: null,
    guard: matrix.guard,
    model: { ...realModelStats, botModel, reasoningEffort: effort },
    errors: matrix.errors,
    shards: 1,
    cases: all.filter((item) => chosen.has(item.index)),
  });
  const previous = readJson(option('previous'));
  report.judge = {
    ...judge,
    previous: previous?.judge?.averages ?? null,
  };
  // Golden expectations were written for the scripted model: with a real model they are reported, not enforced
  const gatesFailed = Object.values(report.gates).reduce((a, b) => a + b, 0) > 0;
  report.passed = !gatesFailed && !report.errors.length;
  writeReport(report, previous);
  appendJudge(report);
  return flag('no-fail-on-gates') ? true : report.passed;
}

function appendJudge(report: SimReport) {
  const judge = report.judge!;
  const lines = ['', `## Nota do juiz (${judge.model}, ${judge.judged} conversas)`, ''];
  lines.push('| Critério | Média | Anterior | Δ |', '|---|---:|---:|---:|');
  for (const [key, value] of Object.entries(judge.averages as Record<string, number | null>)) {
    const before = judge.previous?.[key] ?? null;
    const d = value !== null && before !== null ? (value - before).toFixed(2) : '';
    lines.push(
      `| ${key} | ${value === null ? '—' : value.toFixed(2)} | ${before === null ? '—' : before.toFixed(2)} | ${d} |`,
    );
  }
  lines.push('', '## Amostra para revisão humana (10 piores)', '');
  for (const item of judge.worst as any[]) {
    lines.push(
      `<details><summary>${item.id} — média ${item.score.media.toFixed(1)}: ${item.score.comentario}</summary>\n\n\`\`\`\n${item.transcript.join('\n')}\n\`\`\`\n</details>`,
    );
  }
  const markdown = lines.join('\n');
  appendFileSync(join(OUT, 'report.md'), `${markdown}\n`);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

// ------------------------------------------------------------------------------------------------ entry

(async () => {
  const part = option('part');
  try {
    if (part) {
      await runPart(part, option('json')!);
      process.exit(0);
    }
    const ok = flag('real-model') ? await runEval() : await runAll();
    process.exit(ok ? 0 : 1);
  } catch (error: any) {
    console.error(error?.stack ?? error);
    process.exit(2);
  }
})();
