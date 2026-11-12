const API_URL = (localStorage.getItem('apiUrl') || '').replace(/\/+$/, '');
const TOKEN = localStorage.getItem('token') || '';
const REFRESH_MS = 60000;
const REQUEST_TIMEOUT_MS = 30000;

const providersEl = document.getElementById('providers');
const summaryEl = document.getElementById('summary');
const alertEl = document.getElementById('alert');
const updatedEl = document.getElementById('updated');
const refreshButton = document.getElementById('refresh');

let loading = false;
let lastLoadedAt = 0;
let lastData = null;
let autoRefresh = true;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function formatNumber(value, digits) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const maximumFractionDigits = digits ?? (Math.abs(number) >= 100 ? 0 : Math.abs(number) >= 10 ? 1 : 2);
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(number);
}

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (number === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(Math.abs(number)) / Math.log(1024)), units.length - 1);
  return `${formatNumber(number / 1024 ** index, index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return '—';
  if (minutes < 1) return `${formatNumber(minutes * 60, 0)} s`;
  if (minutes < 60) return `${formatNumber(minutes, minutes < 10 ? 1 : 0)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return `${hours}h${rest ? ` ${rest}min` : ''}`;
}

function formatMetricValue(value, unit) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  if (unit === 'bytes') return formatBytes(value);
  if (unit === 'hours') return `${formatNumber(value)} h`;
  if (unit === 'cu_hours') return `${formatNumber(value)} CU-h`;
  if (unit === 'minutes') return formatMinutes(value);
  if (unit === 'count') return formatNumber(value, 0);
  return formatNumber(value);
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function statusClass(value) {
  const status = String(value ?? '').toLowerCase();
  if (['ok', 'ready', 'live', 'active', 'succeeded', 'deployed', 'available'].includes(status)) return 'ok';
  if (['error', 'failed', 'canceled', 'cancelled', 'suspended', 'suspenso', 'critical'].includes(status)) return 'critical';
  return 'warning';
}

function providerStatusLabel(status) {
  if (status === 'ok') return 'Operacional';
  if (status === 'partial') return 'Parcial';
  if (status === 'missing') return 'Não configurado';
  if (status === 'error') return 'Erro';
  return status;
}

function providerMark(provider) {
  const marks = { neon: 'N', render: 'R', vercel: 'V', github: 'G' };
  return marks[provider.id] || String(provider.name || '?').slice(0, 1).toUpperCase();
}

function metricHtml(metric) {
  const used = formatMetricValue(metric.used, metric.unit);
  const limit = metric.limit !== null && metric.limit !== undefined ? formatMetricValue(metric.limit, metric.unit) : null;
  const percent = metric.percent !== null && metric.percent !== undefined ? Math.max(0, Math.min(100, Number(metric.percent))) : null;
  const status = metric.status || 'unknown';

  return `
    <div class="obs-metric ${escapeHtml(status)}">
      <div class="obs-metric-top">
        <span class="obs-metric-label" title="${escapeHtml(metric.detail || metric.label)}">${escapeHtml(metric.label)}</span>
        <span class="obs-metric-value">${escapeHtml(used)}</span>
      </div>
      ${limit ? `<div class="obs-metric-limit">de ${escapeHtml(limit)}${percent !== null ? ` · ${formatNumber(percent, 0)}%` : ''}</div>` : ''}
      ${percent !== null ? `<div class="obs-bar"><span style="width:${percent}%"></span></div>` : ''}
      ${metric.detail ? `<div class="obs-metric-detail">${escapeHtml(metric.detail)}</div>` : ''}
    </div>
  `;
}

function resourceHtml(resource) {
  const url = safeUrl(resource.url);
  const meta = [resource.type, resource.plan, resource.region].filter(Boolean).map((item) => escapeHtml(item)).join(' · ');
  const status = resource.status ? `<span class="obs-status ${statusClass(resource.status)}">${escapeHtml(resource.status)}</span>` : '';

  return `
    <div class="obs-resource">
      <div class="obs-resource-main">
        <div class="obs-resource-title">${escapeHtml(resource.name)}${status}</div>
        ${meta ? `<div class="obs-resource-sub">${meta}</div>` : ''}
        ${resource.detail ? `<div class="obs-resource-detail">${escapeHtml(resource.detail)}</div>` : ''}
      </div>
      ${url ? `<a class="obs-resource-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir</a>` : ''}
    </div>
  `;
}

function missingHtml(provider) {
  const envLine = (provider.notes || []).find((note) => note.startsWith('Variáveis necessárias:')) || '';
  const description = (provider.notes || []).find((note) => note !== envLine) || 'Configure as variáveis para ativar este provedor.';

  return `
    <div class="obs-setup">
      <p>${escapeHtml(description)}</p>
      ${envLine ? `<code>${escapeHtml(envLine.replace('Variáveis necessárias: ', '').replace(/\.$/, ''))}</code>` : ''}
    </div>
  `;
}

function providerHtml(provider) {
  const configured = provider.configured !== false;
  const status = provider.status || 'missing';
  const plan = provider.plan ? `<span class="obs-badge">${escapeHtml(provider.plan)}</span>` : '';
  const statusBadge = `<span class="obs-badge ${escapeHtml(status)}">${escapeHtml(providerStatusLabel(status))}</span>`;
  const metrics = Array.isArray(provider.metrics) ? provider.metrics.filter(Boolean) : [];
  const resources = Array.isArray(provider.resources) ? provider.resources.filter(Boolean) : [];
  const notes = Array.isArray(provider.notes) ? provider.notes.filter(Boolean) : [];
  const links = Array.isArray(provider.links) ? provider.links.map((link) => ({ ...link, safe: safeUrl(link.url) })).filter((link) => link.safe) : [];

  return `
    <article class="obs-card" data-provider="${escapeHtml(provider.id)}" data-status="${escapeHtml(status)}">
      <header class="obs-card-head">
        <div class="obs-provider">
          <span class="obs-mark">${escapeHtml(providerMark(provider))}</span>
          <div>
            <h2>${escapeHtml(provider.name)}</h2>
            <p>${escapeHtml(provider.description || '')}</p>
          </div>
        </div>
        <div class="obs-card-head-right">
          ${plan}
          ${statusBadge}
        </div>
      </header>

      ${provider.error ? `<div class="obs-error">${escapeHtml(provider.error)}</div>` : ''}
      ${!configured ? missingHtml(provider) : ''}

      ${metrics.length ? `<div class="obs-metrics">${metrics.map(metricHtml).join('')}</div>` : configured ? '<div class="obs-empty">Nenhuma métrica disponível.</div>' : ''}
      ${resources.length ? `<div class="obs-resources">${resources.map(resourceHtml).join('')}</div>` : ''}

      ${configured && notes.length ? `<ul class="obs-notes">${notes.filter((note) => !note.startsWith('Variáveis necessárias:')).map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : ''}

      ${links.length ? `<footer class="obs-card-footer">${links.map((link) => `<a class="obs-link" href="${escapeHtml(link.safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`).join('')}</footer>` : ''}
    </article>
  `;
}

function renderSummary(data) {
  const providers = Array.isArray(data.providers) ? data.providers : [];
  const configured = providers.filter((provider) => provider.configured).length;
  const missing = providers.filter((provider) => provider.status === 'missing').length;
  const issues = providers.filter((provider) => provider.status === 'partial' || provider.status === 'error').length;

  summaryEl.innerHTML = `
    <span class="obs-pill"><span class="obs-dot ok"></span><strong>${configured}</strong> configurados</span>
    <span class="obs-pill"><span class="obs-dot ${missing ? 'warning' : 'ok'}"></span><strong>${missing}</strong> sem chave</span>
    <span class="obs-pill"><span class="obs-dot ${issues ? 'warning' : 'ok'}"></span><strong>${issues}</strong> com alerta</span>
  `;
}

function renderAlert(data) {
  const providers = Array.isArray(data.providers) ? data.providers : [];
  const missing = providers.filter((provider) => provider.status === 'missing');
  const errors = providers.filter((provider) => provider.status === 'error');

  if (errors.length) {
    showAlert('error', `${errors.length} provedor(es) com erro de consulta. Veja os detalhes nos cards.`);
    return;
  }

  if (missing.length) {
    showAlert(
      'warning',
      `${missing.length} provedor(es) sem chave. <a href="#config">Configure as variáveis</a> para liberar os dados.`,
    );
    return;
  }

  clearAlert();
}

function render(data) {
  lastData = data;
  lastLoadedAt = Date.now();
  renderSummary(data);
  renderAlert(data);
  providersEl.innerHTML = (data.providers || []).map(providerHtml).join('');
  updateUpdatedLabel();
}

function showAlert(type, message) {
  alertEl.hidden = false;
  alertEl.className = `obs-alert ${type === 'error' ? '' : type}`.trim();
  alertEl.innerHTML = message;
}

function clearAlert() {
  alertEl.hidden = true;
  alertEl.innerHTML = '';
  alertEl.className = 'obs-alert';
}

function updateUpdatedLabel() {
  if (!lastLoadedAt) {
    updatedEl.textContent = 'Carregando...';
    return;
  }

  const seconds = Math.max(0, Math.floor((Date.now() - lastLoadedAt) / 1000));
  const label = seconds < 5 ? 'agora' : seconds < 60 ? `há ${seconds}s` : `há ${Math.floor(seconds / 60)}min`;
  updatedEl.textContent = `Atualizado ${label}`;
}

function showSessionError() {
  updatedEl.textContent = 'Sessão não encontrada';
  providersEl.innerHTML = `
    <div class="obs-empty" style="grid-column:1/-1;padding:32px">
      Abra o painel e faça login para carregar a observabilidade.
      <div style="margin-top:14px"><a class="obs-link" href="/manager/login">Ir para o login</a></div>
    </div>
  `;
}

async function load(force = false) {
  if (loading) return;

  if (!API_URL || !TOKEN) {
    showSessionError();
    return;
  }

  loading = true;
  refreshButton.disabled = true;
  refreshButton.classList.add('is-loading');
  updatedEl.textContent = 'Atualizando...';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}/observability${force ? '?refresh=1' : ''}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        apikey: TOKEN,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (response.status === 401 || response.status === 403) {
      showAlert('error', 'Sessão expirada ou sem permissão. <a href="/manager/login">Entrar novamente</a>.');
      if (!lastData) showSessionError();
      return;
    }

    if (!response.ok) {
      const message = data?.message || data?.error || `Falha ao consultar a API (HTTP ${response.status}).`;
      throw new Error(message);
    }

    if (!data || !Array.isArray(data.providers)) {
      throw new Error('Resposta inválida da API de observabilidade.');
    }

    render(data);
    clearAlert();
    renderAlert(data);
  } catch (error) {
    const message =
      error?.name === 'AbortError'
        ? 'A consulta demorou demais. Tente novamente.'
        : error?.message || 'Não foi possível carregar a observabilidade.';
    showAlert('error', escapeHtml(message));
    if (!lastData) {
      providersEl.innerHTML = `<div class="obs-empty" style="grid-column:1/-1;padding:32px">${escapeHtml(message)}</div>`;
    }
  } finally {
    clearTimeout(timeout);
    loading = false;
    refreshButton.disabled = false;
    refreshButton.classList.remove('is-loading');
    updateUpdatedLabel();
  }
}

refreshButton.addEventListener('click', () => load(true));

document.addEventListener('click', (event) => {
  const trigger = event.target instanceof Element ? event.target.closest('a[href="#config"]') : null;
  if (!trigger) return;
  event.preventDefault();
  const help = document.querySelector('.obs-help');
  help?.setAttribute('open', '');
  if (help && typeof help.scrollIntoView === 'function') help.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/*whatsai-patch:qa-funcional-medio:no-poll*/
// No background polling. The overview reads the control database (own databases and instance usage), so it
// only loads when the page opens, when the tab becomes visible again after 60 s and on the Atualizar button.
setInterval(updateUpdatedLabel, 15000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && lastLoadedAt && Date.now() - lastLoadedAt > REFRESH_MS) {
    load(false);
  }
});

load(false);
