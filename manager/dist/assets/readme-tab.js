(function () {
  'use strict';

  var TOKEN_KEY = 'token';
  var isPage = location.pathname.replace(/\/+$/, '') === '/readme';
  var panel = null;
  var sidebar = null;
  var openPath = null;
  var prevTitle = document.title;
  var cachedMd = null;
  var summaryPromise = null;
  var CACHE_KEY = 'whatsai-readme-summary-v1';
  try { cachedMd = window.sessionStorage.getItem(CACHE_KEY); } catch (e) {}

  function authed() {
    try { return !!localStorage.getItem(TOKEN_KEY); } catch (e) { return false; }
  }

  function loadSummary() {
    if (summaryPromise) return summaryPromise;
    summaryPromise = fetch('/readmes/RESUMO.md', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (md) {
        cachedMd = md;
        try { window.sessionStorage.setItem(CACHE_KEY, md); } catch (e) {}
        return md;
      });
    summaryPromise.then(function () { summaryPromise = null; }, function () { summaryPromise = null; });
    return summaryPromise;
  }

  loadSummary().catch(function () {});

  var BTN = 'wr-btn inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3';
  var BTN_PRIMARY = 'wr-btn primary inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-3';

  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function render(md) {
    if (window.marked && typeof window.marked.parse === 'function') {
      return window.marked.parse(md);
    }
    var d = document.createElement('div');
    d.textContent = md;
    return '<pre>' + d.innerHTML + '</pre>';
  }

  function externalLink(href, text, cls) {
    var a = h('a', cls, text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  function wrapTables(body) {
    body.querySelectorAll('table').forEach(function (t) {
      var box = h('div', 'wr-table');
      t.parentNode.insertBefore(box, t);
      box.appendChild(t);
    });
  }

  function buildCard(md) {
    var card = h('article', 'wr-card flex flex-col rounded-lg border bg-card text-card-foreground shadow-sm');

    var head = h('header', 'wr-card-head flex flex-row items-start justify-between gap-4 p-6');
    var copy = h('div', 'wr-head-copy space-y-1.5');
    copy.appendChild(h('div', 'text-xs font-medium text-muted-foreground', 'Manual WhatsAI'));
    copy.appendChild(h('h1', 'wr-title text-2xl font-semibold leading-none tracking-tight', 'Resumo operacional'));
    copy.appendChild(h('p', 'wr-lead text-sm text-muted-foreground', 'Planos, cobrança e onboarding em uma página.'));
    head.appendChild(copy);

    var chips = h('div', 'wr-chips flex flex-wrap gap-2');
    ['Meta: cliente', 'OpenAI: opcional', '1 WABA/cliente'].forEach(function (label) {
      chips.appendChild(h('span', 'wr-chip inline-flex items-center rounded-full border border-transparent bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground transition-colors', label));
    });
    head.appendChild(chips);
    card.appendChild(head);

    var body = h('div', 'wr-body p-6 pt-0');
    body.innerHTML = render(md);
    wrapTables(body);
    card.appendChild(body);

    var foot = h('footer', 'wr-foot flex flex-wrap items-center justify-between gap-3 border-t p-6');
    foot.appendChild(h('span', 'wr-updated text-xs text-muted-foreground', 'Referência: out/2026 · Inspirado no Evolution Foundation/Evolution API'));
    var links = h('div', 'wr-foot-links');
    links.appendChild(externalLink('/readmes/README-WHATSAI.md', 'Manual interno', BTN + ' wr-link'));
    links.appendChild(externalLink('/readmes/README-COMERCIAL.md', 'Guia comercial', BTN + ' wr-link'));
    foot.appendChild(links);
    card.appendChild(foot);

    return card;
  }

  function position(root) {
    if (!root || !root.classList.contains('wr-inline')) return;
    var left = 0;
    if (window.innerWidth >= 768 && sidebar && sidebar.isConnected) {
      var r = sidebar.getBoundingClientRect();
      if (r.width > 40) left = Math.round(r.right);
    }
    root.style.left = left + 'px';
    var header = null;
    var headers = document.querySelectorAll('header');
    for (var i = 0; i < headers.length; i++) {
      if (!root.contains(headers[i])) { header = headers[i]; break; }
    }
    var top = header ? header.offsetHeight : 0;
    root.style.top = (top >= 40 ? top : 56) + 'px';
  }

  function close() {
    if (!panel) return;
    if (isPage) { location.href = '/'; return; }
    panel.remove();
    panel = null;
    openPath = null;
    document.title = prevTitle;
  }

  function open(mode) {
    if (panel) return;

    var managerArea = /^\/manager(?:\/|$)/.test(location.pathname);
    if (!authed() && managerArea) { location.href = '/manager/login'; return; }
    var inline = mode === 'inline' && managerArea;
    if (inline) {
      var anchor = document.querySelector('a[href="/readme"]');
      sidebar = anchor ? anchor.closest('ul') : null;
    }

    var root = h('div');
    root.id = 'whatsai-readme';
    root.className = inline ? 'wr-inline' : 'wr-page';

    if (!inline) {
      var top = h('div', 'wr-top');
      var topIn = h('div', 'wr-top-in');
      var brand = h('div', 'wr-brand');
      brand.appendChild(h('span', 'text-sm font-semibold', 'Manual'));
      brand.appendChild(h('span', 'wr-sub text-sm text-muted-foreground', 'Resumo operacional'));
      topIn.appendChild(brand);

      var actions = h('div', 'wr-actions');
      var topLinks = h('div', 'wr-top-links');
      topLinks.appendChild(externalLink('/readmes/README-WHATSAI.md', 'Manual completo', BTN));
      topLinks.appendChild(externalLink('/readmes/README-COMERCIAL.md', 'Guia comercial', BTN));
      actions.appendChild(topLinks);

      if (isPage) {
        actions.appendChild(externalLink('/', 'Voltar ao painel', BTN_PRIMARY));
      } else {
        var closeBtn = h('button', BTN_PRIMARY, 'Fechar');
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', function () { close(); });
        actions.appendChild(closeBtn);
      }
      topIn.appendChild(actions);
      top.appendChild(topIn);
      root.appendChild(top);
    }

    var wrap = h('div', 'wr-wrap');
    root.appendChild(wrap);

    var status = null;
    var statusTimer = null;
    if (cachedMd) {
      wrap.appendChild(buildCard(cachedMd));
    } else {
      status = h('div', 'wr-status text-sm text-muted-foreground', 'Carregando resumo…');
      status.style.display = 'none';
      wrap.appendChild(status);
      statusTimer = setTimeout(function () { status.style.display = ''; }, 150);
    }

    document.body.appendChild(root);
    panel = root;
    openPath = location.pathname;
    document.title = 'Manual — WhatsAI';

    if (inline) {
      position(root);
      window.addEventListener('resize', function () { position(panel); });
    }

    if (!cachedMd) {
      loadSummary()
        .then(function (md) {
          clearTimeout(statusTimer);
          status.remove();
          wrap.appendChild(buildCard(md));
        })
        .catch(function (err) {
          clearTimeout(statusTimer);
          status.style.display = '';
          status.textContent = 'Falha ao carregar o resumo: ' + err.message;
        });
    }
  }

  if (isPage) {
    open('page');
    return;
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var link = t.closest('a[href="/readme"]');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      open('inline');
      return;
    }

    if (panel && panel.classList.contains('wr-inline') && !panel.contains(t)) {
      close();
      return;
    }
  }, true);

  window.setInterval(function () {
    if (panel && panel.classList.contains('wr-inline') && openPath !== location.pathname) {
      close();
    }
  }, 200);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();
