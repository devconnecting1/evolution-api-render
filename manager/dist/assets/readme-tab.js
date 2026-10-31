/*
 * WhatsAI Manager: manual (documentation layout). Plain script, no dependencies besides marked (marked.min.js).
 * Opens as a page at /readme (top bar, own <main>) or inline in the Manager (the "Manual" item of the instance
 * menu; panel beside the menu, closes on Escape, "Fechar", a click outside or a route change).
 * Layout: documents on the left (with a title search over documents and their sections), content column
 * (~720px), "Nesta página" (h2/h3 of the current document) on the right. Narrow widths: the document list is
 * a drawer opened by "Menu do manual" and "Nesta página" becomes an accordion above the content.
 * Content: the markdown files of /readmes, unchanged.
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'token';
  var isPage = location.pathname.replace(/\/+$/, '') === '/readme';
  var DOCS = [
    { id: 'RESUMO', file: 'RESUMO.md', title: 'Resumo operacional', group: 'Comece aqui',
      lead: 'Planos, cobrança e onboarding em uma página.' },
    { id: 'README-WHATSAI', file: 'README-WHATSAI.md', title: 'Manual completo', group: 'Referência',
      lead: 'Arquitetura, deploy, onboarding, observabilidade, bot OpenAI e manutenção.' },
    { id: 'README-COMERCIAL', file: 'README-COMERCIAL.md', title: 'Guia comercial', group: 'Referência',
      lead: 'Custos por cliente, preço sugerido e cuidados de contrato.' },
  ];
  var CACHE_PREFIX = 'whatsai-readme-v2:';
  var mdCache = {};
  var pending = {};
  var panel = null;
  var sidebar = null;
  var openPath = null;
  var prevTitle = document.title;
  var current = null;
  var spy = null;
  var resizeHandler = null;

  function authed() {
    try { return !!localStorage.getItem(TOKEN_KEY); } catch (e) { return false; }
  }

  function docById(id) {
    for (var i = 0; i < DOCS.length; i++) if (DOCS[i].id === id) return DOCS[i];
    return DOCS[0];
  }

  function loadDoc(doc) {
    if (mdCache[doc.id] != null) return Promise.resolve(mdCache[doc.id]);
    try {
      var saved = sessionStorage.getItem(CACHE_PREFIX + doc.id);
      if (saved) { mdCache[doc.id] = saved; return Promise.resolve(saved); }
    } catch (e) {}
    if (pending[doc.id]) return pending[doc.id];
    pending[doc.id] = fetch('/readmes/' + doc.file, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (md) {
        mdCache[doc.id] = md;
        try { sessionStorage.setItem(CACHE_PREFIX + doc.id, md); } catch (e) {}
        delete pending[doc.id];
        return md;
      }, function (err) {
        delete pending[doc.id];
        throw err;
      });
    return pending[doc.id];
  }

  // ------------------------------------------------------------------------------------------ helpers
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function svg(paths) {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', '16');
    s.setAttribute('height', '16');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    paths.forEach(function (d) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }
  var ICON_MENU = ['M4 6h16', 'M4 12h16', 'M4 18h16'];
  var ICON_CLOSE = ['M18 6 6 18', 'M6 6l12 12'];
  var ICON_SEARCH = ['M21 21l-4.3-4.3', 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z'];

  function slug(text, used) {
    var base = String(text || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'secao';
    var id = base;
    var n = 2;
    while (used[id]) id = base + '-' + n++;
    used[id] = true;
    return id;
  }

  function render(md) {
    if (window.marked && typeof window.marked.parse === 'function') return window.marked.parse(md);
    var d = document.createElement('div');
    d.textContent = md;
    return '<pre>' + d.innerHTML + '</pre>';
  }

  function headingsOf(md) {
    // titles of a document without rendering it (search index): ## and ### outside code fences
    var out = [];
    var fence = false;
    String(md).split('\n').forEach(function (line) {
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
      if (fence) return;
      var m = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
      if (m) out.push({ level: m[1].length, text: m[2].replace(/`/g, '').replace(/\*\*/g, '') });
    });
    return out;
  }

  var copyStatus = null;
  function copyText(text, btn) {
    function done(ok) {
      btn.textContent = ok ? 'Copiado' : 'Não foi possível copiar';
      if (copyStatus) copyStatus.textContent = ok ? 'Código copiado.' : 'Não foi possível copiar o código.';
      setTimeout(function () { btn.textContent = 'Copiar'; }, 1600);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      done(ok);
    } catch (e) {
      done(false);
    }
  }

  function enhance(body, used) {
    var heads = [];
    body.querySelectorAll('h1, h2, h3, h4').forEach(function (el) {
      if (el.tagName === 'H1') {
        var h2 = document.createElement('h2');
        h2.innerHTML = el.innerHTML;
        el.replaceWith(h2);
        el = h2;
      }
      el.id = slug(el.textContent, used);
      if (el.tagName === 'H2' || el.tagName === 'H3') heads.push({ level: el.tagName === 'H2' ? 2 : 3, id: el.id, text: el.textContent });
    });
    body.querySelectorAll('table').forEach(function (t) {
      var box = h('div', 'wr-table');
      box.setAttribute('tabindex', '0');
      box.setAttribute('role', 'region');
      box.setAttribute('aria-label', 'Tabela (role para os lados se precisar)');
      t.parentNode.insertBefore(box, t);
      box.appendChild(t);
    });
    body.querySelectorAll('blockquote').forEach(function (q) {
      var text = q.textContent.trim();
      q.className = 'wr-callout';
      if (/^(atenção|importante|cuidado|aviso)\b/i.test(text) || /\bNÃO\b/.test(text)) q.setAttribute('data-tone', 'warn');
    });
    body.querySelectorAll('pre').forEach(function (pre) {
      var box = h('div', 'wr-code');
      pre.parentNode.insertBefore(box, pre);
      box.appendChild(pre);
      pre.setAttribute('tabindex', '0');
      var btn = h('button', 'wr-copy', 'Copiar');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Copiar código');
      btn.addEventListener('click', function () {
        copyText((pre.querySelector('code') || pre).innerText.replace(/\n$/, ''), btn);
      });
      box.appendChild(btn);
    });
    body.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (/^https?:\/\//i.test(href)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        var hint = h('span', 'wr-sr', ' (abre em nova aba)');
        a.appendChild(hint);
      }
    });
    return heads;
  }

  // ------------------------------------------------------------------------------------------- layout
  function position(root) {
    if (!root || !root.classList.contains('wr-inline')) return;
    var left = 0;
    if (window.innerWidth >= 1024 && sidebar && sidebar.isConnected) {
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
    if (!panel || isPage) return;
    if (spy) { spy.disconnect(); spy = null; }
    if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
    panel.remove();
    panel = null;
    openPath = null;
    document.title = prevTitle;
  }

  function build(inline) {
    var root = h('div');
    root.id = 'whatsai-readme';
    root.className = inline ? 'wr-inline' : 'wr-page';
    if (inline) {
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'false');
      root.setAttribute('aria-labelledby', 'wr-title');
    }

    var menuBtn = h('button', 'wr-menu-btn');
    menuBtn.type = 'button';
    menuBtn.setAttribute('data-wr-menu', '');
    menuBtn.setAttribute('aria-controls', 'wr-side');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.appendChild(svg(ICON_MENU));
    menuBtn.appendChild(h('span', null, 'Menu do manual'));

    if (!inline) {
      var top = h('header', 'wr-top');
      var brand = h('div', 'wr-top-brand');
      var home = h('a', 'wr-wordmark', 'WhatsAI');
      home.href = '/';
      home.setAttribute('aria-label', 'WhatsAI, página inicial');
      brand.appendChild(home);
      brand.appendChild(h('span', 'wr-top-sep', '/'));
      brand.appendChild(h('span', 'wr-top-name', 'Manual'));
      top.appendChild(brand);
      var actions = h('div', 'wr-top-actions');
      actions.appendChild(menuBtn);
      var panelLink = h('a', 'wr-btn wr-btn-ink', authed() ? 'Abrir o painel' : 'Entrar no painel');
      panelLink.href = authed() ? '/manager/' : '/manager/login';
      actions.appendChild(panelLink);
      top.appendChild(actions);
      root.appendChild(top);
    }

    var shell = h('div', 'wr-shell');

    // documents + search
    var side = h('nav', 'wr-side');
    side.id = 'wr-side';
    side.setAttribute('aria-label', 'Documentos do manual');
    var search = h('div', 'wr-search');
    var label = h('label', 'wr-sr', 'Buscar no manual por título');
    label.setAttribute('for', 'wr-search-input');
    var input = h('input');
    input.id = 'wr-search-input';
    input.type = 'search';
    input.placeholder = 'Buscar por título';
    input.autocomplete = 'off';
    input.setAttribute('aria-describedby', 'wr-search-count');
    search.appendChild(svg(ICON_SEARCH));
    search.appendChild(label);
    search.appendChild(input);
    side.appendChild(search);
    var count = h('p', 'wr-sr');
    count.id = 'wr-search-count';
    count.setAttribute('aria-live', 'polite');
    side.appendChild(count);
    var results = h('ul', 'wr-results');
    results.hidden = true;
    side.appendChild(results);
    var lists = h('div', 'wr-doc-groups');
    var groups = {};
    DOCS.forEach(function (doc) {
      if (!groups[doc.group]) {
        lists.appendChild(h('p', 'wr-side-h', doc.group));
        groups[doc.group] = h('ul', 'wr-docs');
        lists.appendChild(groups[doc.group]);
      }
      var li = h('li');
      var a = h('a', 'wr-doc-link', doc.title);
      a.href = '/readme?doc=' + encodeURIComponent(doc.id);
      a.setAttribute('data-doc', doc.id);
      li.appendChild(a);
      groups[doc.group].appendChild(li);
    });
    side.appendChild(lists);
    var files = h('div', 'wr-side-foot');
    files.appendChild(h('p', 'wr-side-h', 'Arquivos'));
    var fileList = h('ul', 'wr-docs');
    DOCS.forEach(function (doc) {
      var li = h('li');
      var a = h('a', 'wr-doc-link wr-file', doc.file);
      a.href = '/readmes/' + doc.file;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(h('span', 'wr-sr', ' (markdown, abre em nova aba)'));
      li.appendChild(a);
      fileList.appendChild(li);
    });
    files.appendChild(fileList);
    side.appendChild(files);
    shell.appendChild(side);

    var backdrop = h('div', 'wr-backdrop');
    backdrop.hidden = true;
    shell.appendChild(backdrop);

    // content
    var scroller = h('div', 'wr-scroll');
    var cols = h('div', 'wr-cols');
    var main = h(inline ? 'div' : 'main', 'wr-main');
    main.id = 'wr-main';
    if (inline) {
      var bar = h('div', 'wr-bar');
      bar.appendChild(menuBtn);
      var closeBtn = h('button', 'wr-btn wr-close', 'Fechar manual');
      closeBtn.type = 'button';
      closeBtn.prepend(svg(ICON_CLOSE));
      closeBtn.addEventListener('click', function () { close(); });
      bar.appendChild(closeBtn);
      main.appendChild(bar);
    }
    var content = h('div', 'wr-content');
    main.appendChild(content);
    cols.appendChild(main);
    var toc = h('aside', 'wr-toc');
    toc.setAttribute('aria-labelledby', 'wr-toc-h');
    cols.appendChild(toc);
    scroller.appendChild(cols);
    shell.appendChild(scroller);
    root.appendChild(shell);

    copyStatus = h('p', 'wr-sr');
    copyStatus.setAttribute('aria-live', 'polite');
    root.appendChild(copyStatus);

    var ui = { root: root, inline: inline, side: side, input: input, results: results, count: count,
      backdrop: backdrop, scroller: scroller, content: content, toc: toc, menuBtn: menuBtn };

    function setDrawer(open) {
      root.classList.toggle('wr-drawer-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      backdrop.hidden = !open;
      if (open) {
        var target = side.querySelector('[aria-current="page"]') || input;
        setTimeout(function () { target.focus(); }, 0);
      }
    }
    ui.setDrawer = setDrawer;
    menuBtn.addEventListener('click', function () { setDrawer(!root.classList.contains('wr-drawer-open')); });
    backdrop.addEventListener('click', function () { setDrawer(false); menuBtn.focus(); });

    side.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-doc]');
      if (!a) return;
      e.preventDefault();
      setDrawer(false);
      show(ui, a.getAttribute('data-doc'), a.getAttribute('data-anchor'), true);
    });
    input.addEventListener('input', function () { runSearch(ui); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; runSearch(ui); }
    });
    return ui;
  }

  function runSearch(ui) {
    var q = ui.input.value.trim().toLowerCase();
    var norm = function (s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
    if (!q) {
      ui.results.hidden = true;
      ui.results.textContent = '';
      ui.count.textContent = '';
      ui.root.classList.remove('wr-searching');
      return;
    }
    ui.root.classList.add('wr-searching');
    Promise.all(DOCS.map(function (d) { return loadDoc(d).catch(function () { return ''; }); })).then(function (mds) {
      if (ui.input.value.trim().toLowerCase() !== q) return;
      var nq = norm(q);
      var hits = [];
      DOCS.forEach(function (doc, idx) {
        if (norm(doc.title).indexOf(nq) >= 0) hits.push({ doc: doc, text: doc.title, anchor: null });
        var used = {};
        headingsOf(mds[idx]).forEach(function (hd) {
          var id = slug(hd.text, used);
          if (hd.level === 1) return;
          if (norm(hd.text).indexOf(nq) >= 0) hits.push({ doc: doc, text: hd.text, anchor: id });
        });
      });
      ui.results.textContent = '';
      hits.slice(0, 30).forEach(function (hit) {
        var li = h('li');
        var a = h('a', 'wr-result');
        a.href = '/readme?doc=' + encodeURIComponent(hit.doc.id) + (hit.anchor ? '#' + hit.anchor : '');
        a.setAttribute('data-doc', hit.doc.id);
        if (hit.anchor) a.setAttribute('data-anchor', hit.anchor);
        a.appendChild(h('span', 'wr-result-t', hit.text));
        a.appendChild(h('span', 'wr-result-d', hit.doc.title));
        li.appendChild(a);
        ui.results.appendChild(li);
      });
      if (!hits.length) ui.results.appendChild(h('li', 'wr-result-none', 'Nenhum título encontrado.'));
      ui.results.hidden = false;
      ui.count.textContent = hits.length ? hits.length + ' resultado(s).' : 'Nenhum título encontrado.';
    });
  }

  function scrollToId(ui, id, smooth) {
    var el = id && ui.content.querySelector('#' + CSS.escape(id));
    if (!el) return false;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: smooth && !reduce ? 'smooth' : 'auto', block: 'start' });
    el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch (e) {}
    return true;
  }

  function buildToc(ui, heads) {
    ui.toc.textContent = '';
    var items = heads.filter(function (x) { return x.level <= 3; });
    if (!items.length) { ui.toc.hidden = true; return null; }
    ui.toc.hidden = false;
    var head = h('p', 'wr-toc-h', 'Nesta página');
    head.id = 'wr-toc-h';
    ui.toc.appendChild(head);
    function list() {
      var ul = h('ul', 'wr-toc-list');
      items.forEach(function (it) {
        var li = h('li', it.level === 3 ? 'wr-toc-sub' : null);
        var a = h('a', 'wr-toc-link', it.text);
        a.href = '#' + it.id;
        a.setAttribute('data-target', it.id);
        li.appendChild(a);
        ul.appendChild(li);
      });
      return ul;
    }
    ui.toc.appendChild(list());
    // narrow widths: the same list as an accordion above the content
    var acc = h('details', 'wr-toc-m');
    acc.appendChild(h('summary', null, 'Nesta página'));
    acc.appendChild(list());
    return acc;
  }

  function watch(ui) {
    if (spy) { spy.disconnect(); spy = null; }
    if (!('IntersectionObserver' in window)) return;
    var links = ui.toc.querySelectorAll('.wr-toc-link');
    if (!links.length) return;
    var heads = Array.prototype.map.call(links, function (a) { return ui.content.querySelector('#' + CSS.escape(a.getAttribute('data-target'))); }).filter(Boolean);
    var visible = {};
    spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting; });
      var active = null;
      for (var i = 0; i < heads.length; i++) {
        if (visible[heads[i].id]) { active = heads[i].id; break; }
      }
      if (!active) {
        // nothing in view: the last heading above the top
        var topY = ui.scroller.getBoundingClientRect().top;
        for (var j = 0; j < heads.length; j++) if (heads[j].getBoundingClientRect().top < topY + 40) active = heads[j].id;
      }
      links.forEach(function (a) {
        var on = a.getAttribute('data-target') === active;
        a.classList.toggle('is-active', on);
        if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
      });
    }, { root: ui.scroller, rootMargin: '0px 0px -70% 0px', threshold: 0 });
    heads.forEach(function (el) { spy.observe(el); });
  }

  function show(ui, id, anchor, userAction) {
    var doc = docById(id);
    current = doc.id;
    ui.side.querySelectorAll('.wr-doc-link[data-doc]').forEach(function (a) {
      if (a.getAttribute('data-doc') === doc.id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (isPage && userAction) {
      try { history.replaceState(null, '', '/readme?doc=' + encodeURIComponent(doc.id) + (anchor ? '#' + anchor : '')); } catch (e) {}
    }
    document.title = doc.title + ' · Manual WhatsAI';
    var status = null;
    var timer = null;
    if (mdCache[doc.id] == null) {
      ui.content.setAttribute('aria-busy', 'true');
      timer = setTimeout(function () {
        ui.content.textContent = '';
        status = h('div', 'wr-loading');
        status.appendChild(h('span', 'wr-sr', 'Carregando o manual'));
        ['wr-sk-t', 'wr-sk-l', 'wr-sk-p', 'wr-sk-p', 'wr-sk-s'].forEach(function (c) {
          var s = h('span', 'wr-sk ' + c);
          s.setAttribute('aria-hidden', 'true');
          status.appendChild(s);
        });
        ui.content.appendChild(status);
      }, 120);
    }
    loadDoc(doc).then(function (md) {
      clearTimeout(timer);
      if (current !== doc.id) return;
      ui.content.removeAttribute('aria-busy');
      fill(ui, doc, md);
      if (anchor && scrollToId(ui, anchor, false)) return;
      ui.scroller.scrollTop = 0;
      if (userAction) {
        var title = ui.content.querySelector('.wr-title');
        if (title) { title.setAttribute('tabindex', '-1'); try { title.focus({ preventScroll: true }); } catch (e) {} }
      }
    }, function (err) {
      clearTimeout(timer);
      if (current !== doc.id) return;
      ui.content.removeAttribute('aria-busy');
      ui.content.textContent = '';
      var box = h('div', 'wr-callout');
      box.setAttribute('data-tone', 'bad');
      box.setAttribute('role', 'alert');
      box.appendChild(h('p', null, 'Não foi possível carregar “' + doc.title + '” (' + err.message + '). Verifique a conexão e tente de novo.'));
      var retry = h('button', 'wr-btn', 'Tentar de novo');
      retry.type = 'button';
      retry.addEventListener('click', function () { show(ui, doc.id, anchor, true); });
      box.appendChild(retry);
      ui.content.appendChild(box);
    });
  }

  function fill(ui, doc, md) {
    var c = ui.content;
    c.textContent = '';
    var body = h('article', 'wr-prose');
    body.innerHTML = render(md);
    var title = doc.title;
    var first = body.firstElementChild;
    if (first && first.tagName === 'H1') {
      title = first.textContent;
      first.remove();
    }
    var used = { 'wr-title': true, 'wr-main': true, 'wr-side': true, 'wr-toc-h': true };
    var heads = enhance(body, used);

    var crumbs = h('nav', 'wr-crumbs');
    crumbs.setAttribute('aria-label', 'Trilha de navegação');
    var ol = h('ol');
    var li1 = h('li');
    var a1 = h('a', null, 'Manual');
    a1.href = '/readme?doc=' + DOCS[0].id;
    a1.setAttribute('data-doc', DOCS[0].id);
    a1.addEventListener('click', function (e) { e.preventDefault(); show(ui, DOCS[0].id, null, true); });
    li1.appendChild(a1);
    ol.appendChild(li1);
    ol.appendChild(h('li', null, doc.group));
    var li3 = h('li', null, doc.title);
    li3.setAttribute('aria-current', 'page');
    ol.appendChild(li3);
    crumbs.appendChild(ol);
    c.appendChild(crumbs);

    var h1 = h(ui.inline ? 'h2' : 'h1', 'wr-title', title);
    h1.id = 'wr-title';
    c.appendChild(h1);
    c.appendChild(h('p', 'wr-lead', doc.lead));

    var acc = buildToc(ui, heads);
    if (acc) c.appendChild(acc);
    c.appendChild(body);

    // previous / next
    var idx = DOCS.indexOf(doc);
    var pager = h('nav', 'wr-pager');
    pager.setAttribute('aria-label', 'Outros documentos');
    [[DOCS[idx - 1], 'Anterior', 'prev'], [DOCS[idx + 1], 'Próximo', 'next']].forEach(function (p) {
      if (!p[0]) { pager.appendChild(h('span')); return; }
      var a = h('a', 'wr-pager-link wr-pager-' + p[2]);
      a.href = '/readme?doc=' + encodeURIComponent(p[0].id);
      a.appendChild(h('span', 'wr-pager-k', p[1]));
      a.appendChild(h('span', 'wr-pager-t', p[0].title));
      a.addEventListener('click', function (e) { e.preventDefault(); show(ui, p[0].id, null, true); });
      pager.appendChild(a);
    });
    c.appendChild(pager);

    var foot = h('footer', 'wr-foot');
    foot.appendChild(h('span', null, 'Referência: out/2026 · Inspirado no Evolution Foundation/Evolution API'));
    var raw = h('a', null, 'Ver o arquivo ' + doc.file);
    raw.href = '/readmes/' + doc.file;
    raw.target = '_blank';
    raw.rel = 'noopener noreferrer';
    raw.appendChild(h('span', 'wr-sr', ' (abre em nova aba)'));
    foot.appendChild(raw);
    c.appendChild(foot);

    ui.root.querySelectorAll('.wr-toc-link').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var id = a.getAttribute('data-target');
        scrollToId(ui, id, true);
        if (isPage) { try { history.replaceState(null, '', '/readme?doc=' + encodeURIComponent(current) + '#' + id); } catch (er) {} }
        var d = a.closest('details');
        if (d) d.open = false;
      });
    });
    watch(ui);
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
    var ui = build(inline);
    document.body.appendChild(ui.root);
    panel = ui.root;
    panel._ui = ui;
    openPath = location.pathname;
    if (inline) {
      position(panel);
      resizeHandler = function () { position(panel); };
      window.addEventListener('resize', resizeHandler);
    }
    var params = new URLSearchParams(location.search);
    var start = isPage ? params.get('doc') : null;
    var hash = isPage && location.hash ? decodeURIComponent(location.hash.slice(1)) : null;
    show(ui, start || DOCS[0].id, hash, false);
    if (inline) {
      var t = ui.root.querySelector('.wr-close');
      if (t) setTimeout(function () { t.focus(); }, 0);
    }
  }

  if (isPage) {
    open('page');
  } else {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var link = t.closest('a[href="/readme"]');
      if (link && !(panel && panel.contains(link))) {
        e.preventDefault();
        e.stopPropagation();
        open('inline');
        return;
      }
      if (panel && panel.classList.contains('wr-inline') && !panel.contains(t)) close();
    }, true);

    window.setInterval(function () {
      if (panel && panel.classList.contains('wr-inline') && openPath !== location.pathname) close();
    }, 200);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !panel) return;
    var ui = panel._ui;
    if (ui && panel.classList.contains('wr-drawer-open')) {
      ui.setDrawer(false);
      ui.menuBtn.focus();
      return;
    }
    close();
  });
})();
