/**
 * Simulation report: JSON (artifact, baseline of the next run) and Markdown (CI job summary).
 * Sections: coverage per dimension, hard gates, quality metrics, golden set, load test, worst examples (short,
 * fictitious), and what changed compared with the baseline report of main.
 */
import { HARD_GATES, Metrics, metricViolations, Threshold } from './checks';
import { DIMENSION_NAMES } from './matrix';

export type SimReport = {
  version: 1;
  generatedAt: string;
  commit: string | null;
  config: { count: number; seed: number; shards: number };
  coverage: {
    perDimension: Record<string, Record<string, number>>;
    pairs: { total: number; covered: number; percent: number };
  };
  gates: Record<string, number>;
  gateExamples: { gate: string; conversation: string; detail: string }[];
  metrics: Metrics;
  thresholds: Record<string, Threshold>;
  metricViolations: string[];
  golden: { total: number; passed: number; failed: { id: string; title: string; problems: string[] }[] };
  burst: Record<string, any> | null;
  guard: Record<string, number>;
  model: Record<string, any>;
  worst: { id: string; reason: string; transcript: string[] }[];
  errors: string[];
  judge?: Record<string, any>;
  passed: boolean;
};

const fmt = (value: number | null | undefined, digits = 3) =>
  value === null || value === undefined ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(digits);

const delta = (now: number | null | undefined, before: number | null | undefined) => {
  if (now === null || now === undefined || before === null || before === undefined) return '';
  const d = now - before;
  if (Math.abs(d) < 1e-9) return '=';
  return `${d > 0 ? '+' : ''}${Math.abs(d) >= 10 ? d.toFixed(0) : d.toFixed(3)}`;
};

export function renderMarkdown(report: SimReport, baseline?: SimReport | null): string {
  const lines: string[] = [];
  const ok = (value: boolean) => (value ? '✅' : '❌');
  lines.push(`# Simulação da IA de atendimento ${ok(report.passed)}`);
  lines.push('');
  lines.push(
    `${report.metrics.conversations} conversas (semente ${report.config.seed}, ${report.config.shards} processos em paralelo), ` +
      `${report.golden.total} conversas de referência e teste de carga com ${report.burst?.contacts ?? 0} contatos.` +
      (report.commit ? ` Commit \`${report.commit.slice(0, 12)}\`.` : ''),
  );
  lines.push('');

  // ---------------------------------------------------------------- what changed
  lines.push('## O que mudou em relação à main');
  lines.push('');
  if (!baseline) {
    lines.push('_Sem relatório anterior da main para comparar (primeira execução ou artefato expirado)._');
  } else {
    const changes: string[] = [];
    for (const gate of HARD_GATES) {
      const now = report.gates[gate] ?? 0;
      const before = baseline.gates[gate] ?? 0;
      if (now !== before) changes.push(`- Trava **${gate}**: ${before} → ${now} falhas`);
    }
    for (const [name, value] of Object.entries(report.metrics)) {
      const before = baseline.metrics[name];
      if (
        typeof value === 'number' &&
        typeof before === 'number' &&
        Math.abs(value - before) > Math.max(1e-6, Math.abs(before) * 0.02)
      ) {
        changes.push(`- ${name}: ${fmt(before)} → ${fmt(value)} (${delta(value, before)})`);
      }
    }
    if (report.golden.passed !== baseline.golden.passed || report.golden.total !== baseline.golden.total) {
      changes.push(
        `- Referência: ${baseline.golden.passed}/${baseline.golden.total} → ${report.golden.passed}/${report.golden.total}`,
      );
    }
    if (report.coverage.pairs.covered !== baseline.coverage.pairs.covered) {
      changes.push(`- Pares cobertos: ${baseline.coverage.pairs.covered} → ${report.coverage.pairs.covered}`);
    }
    lines.push(changes.length ? changes.join('\n') : 'Nenhuma diferença relevante (métricas dentro de 2%).');
  }
  lines.push('');

  // ---------------------------------------------------------------- gates
  const gateTotal = Object.values(report.gates).reduce((a, b) => a + b, 0);
  lines.push(`## Travas (precisam ficar em zero) ${ok(gateTotal === 0)}`);
  lines.push('');
  lines.push('| Trava | Falhas |');
  lines.push('|---|---:|');
  for (const gate of HARD_GATES) lines.push(`| ${gate} | ${report.gates[gate] ?? 0} |`);
  if (report.gateExamples.length) {
    lines.push('');
    lines.push('Exemplos:');
    for (const example of report.gateExamples.slice(0, 10)) {
      lines.push(`- \`${example.gate}\` ${example.conversation}: ${example.detail}`);
    }
  }
  lines.push('');

  // ---------------------------------------------------------------- metrics
  lines.push(`## Métricas de qualidade ${ok(!report.metricViolations.length)}`);
  lines.push('');
  lines.push(`| Métrica | Valor | Limite | ${baseline ? 'main | Δ |' : ''}`);
  lines.push(`|---|---:|---|${baseline ? '---:|---:|' : ''}`);
  for (const [name, value] of Object.entries(report.metrics)) {
    const limit = report.thresholds[name];
    const text = limit
      ? [limit.min !== undefined ? `≥ ${limit.min}` : '', limit.max !== undefined ? `≤ ${limit.max}` : '']
          .filter(Boolean)
          .join(' ')
      : '';
    const before = baseline?.metrics[name];
    lines.push(`| ${name} | ${fmt(value)} | ${text} | ${baseline ? `${fmt(before)} | ${delta(value, before)} |` : ''}`);
  }
  if (report.metricViolations.length) {
    lines.push('');
    for (const violation of report.metricViolations) lines.push(`- ❌ ${violation}`);
  }
  lines.push('');
  const g = report.guard;
  lines.push(
    `Guarda das respostas: ${g.checked ?? 0} respostas verificadas, ${g.regenerated ?? 0} regeneradas, ` +
      `${g.repeatsRemoved ?? 0} repetições e ${g.policyRemoved ?? 0} frases proibidas removidas, ` +
      `${g.questionsTrimmed ?? 0} perguntas a mais cortadas, ${g.truncated ?? 0} respostas encurtadas. ` +
      `Rascunhos com defeito de propósito do modelo simulado: ${report.model.flawed ?? 0} de ${report.model.calls ?? 0} chamadas.`,
  );
  lines.push('');

  // ---------------------------------------------------------------- golden
  lines.push(
    `## Conversas de referência ${ok(report.golden.passed === report.golden.total)} ${report.golden.passed}/${report.golden.total}`,
  );
  lines.push('');
  for (const failed of report.golden.failed)
    lines.push(`- ❌ **${failed.id}** ${failed.title}: ${failed.problems.join('; ')}`);
  if (!report.golden.failed.length) lines.push('Todas passaram.');
  lines.push('');

  // ---------------------------------------------------------------- burst
  if (report.burst) {
    const b = report.burst;
    lines.push(
      `## Carga: ${b.contacts} contatos ao mesmo tempo ${ok(!b.missing && !b.extra && !b.crossTalk && !b.wrongAddress)}`,
    );
    lines.push('');
    lines.push(
      `${b.replies}/${b.expectedReplies} respostas (uma por turno do cliente), ${b.missing} faltando, ${b.extra} a mais, ` +
        `${b.crossTalk} com dados de outro contato, ${b.wrongAddress} para endereço errado. ` +
        `${fmt(b.virtualSeconds, 0)} s simulados em ${fmt(b.wallMs / 1000, 1)} s reais.`,
    );
    for (const example of b.examples ?? []) lines.push(`- ${example}`);
    lines.push('');
  }

  // ---------------------------------------------------------------- coverage
  lines.push(
    `## Cobertura: ${report.coverage.pairs.covered}/${report.coverage.pairs.total} pares (${fmt(report.coverage.pairs.percent, 1)}%)`,
  );
  lines.push('');
  for (const dim of DIMENSION_NAMES) {
    const values = report.coverage.perDimension[dim] ?? {};
    const counts = Object.values(values);
    lines.push(
      `<details><summary><b>${dim}</b>: ${counts.length} valores, mín. ${Math.min(...counts)} / máx. ${Math.max(...counts)} conversas</summary>\n\n` +
        Object.entries(values)
          .map(([value, count]) => `\`${value}\` ${count}`)
          .join(' · ') +
        '\n\n</details>',
    );
  }
  lines.push('');

  // ---------------------------------------------------------------- worst
  if (report.worst.length) {
    lines.push('## Piores exemplos (fictícios)');
    lines.push('');
    for (const item of report.worst) {
      lines.push(
        `<details><summary>${item.id} — ${item.reason}</summary>\n\n\`\`\`\n${item.transcript.join('\n')}\n\`\`\`\n</details>`,
      );
    }
    lines.push('');
  }
  if (report.errors.length) {
    lines.push('## Erros');
    lines.push('');
    for (const error of report.errors.slice(0, 10)) lines.push(`- \`${error.split('\n')[0]}\``);
  }
  return lines.join('\n');
}

export const failedMetrics = metricViolations;
