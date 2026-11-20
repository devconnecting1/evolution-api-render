/*
 * WhatsAI: página pública (manager/dist/landing/index.html). JavaScript sem
 * dependências, sem cookies e sem rastreadores.
 *
 * CONTATO: troque o número só aqui. Formato internacional, apenas dígitos (55 + DDD + número).
 * Vazio ('') = os botões "Agendar demonstração" / "Falar no WhatsApp" apenas rolam até a seção de contato.
 *
 * ORIGEM DO CONTATO: <body data-wa-origin="advocacia"> faz toda mensagem do WhatsApp terminar com
 * "[origem: advocacia]". Se a URL tiver ?utm_source= e/ou ?utm_campaign=, os valores entram na mesma linha
 * ("[origem: instagram · utm_source: ig · utm_campaign: bio]"), limpos (só letras, números, espaço e _ . + -) e com no
 * máximo 40 caracteres cada. Links internos com data-keep-utm levam os mesmos utm_* para a próxima página.
 * FORMULÁRIO (data-wa-form): os campos data-wa-field só montam o texto do campo oculto "text" e o formulário abre o
 * wa.me numa nova aba. Nada vai para um servidor nosso; sem JavaScript, abre com a mensagem padrão do campo oculto.
 *
 * STATUS (data-status): uma leitura de GET /status da API (STATUS_API), com 3 s de limite e sem credenciais. Mostra o
 * estado medido agora e quanto a API levou para responder; se falhar, a faixa continua escondida.
 * EXEMPLO DE CONVERSA (data-demo): conversa fictícia por segmento que se desenrola sozinha; pausa fora da tela e
 * pelo botão, e com "reduzir movimento" mostra só o estado final.
 * AVISO DO TOPO (data-annc): o botão fecha e grava ANNC_KEY no localStorage; o theme.js lê a mesma chave antes da pintura.
 */
const CONTACT_WHATSAPP = '5521974699723';
const DEFAULT_MESSAGE = 'Olá! Vi o site do WhatsAI e quero agendar uma demonstração.';
const STATUS_API = 'https://evolution-api-x93o.onrender.com/status';
const ANNC_KEY = 'wa-annc';
const ANNC_VALUE = 'piloto-14d';

(function () {
  'use strict';
  const root = document.documentElement;
  root.classList.add('js');

  const digits = String(CONTACT_WHATSAPP || '').replace(/\D/g, '');

  // ------------------------------------------------------------------ origem + utm (só no texto da mensagem)
  function clean(value, max) {
    let s = String(value == null ? '' : value);
    try {
      s = s.normalize('NFC').replace(/[^\p{L}\p{N} _.+-]/gu, ' ');
    } catch (e) {
      s = s.replace(/[^A-Za-z0-9 _.+-]/g, ' ');
    }
    return s.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  }
  let query;
  try {
    query = new URLSearchParams(window.location.search);
  } catch (e) {
    query = { get: function () { return null; } };
  }
  const utm = { source: clean(query.get('utm_source'), 40), campaign: clean(query.get('utm_campaign'), 40) };
  const origin = clean(document.body && document.body.getAttribute('data-wa-origin'), 40);

  function sourceTag() {
    const parts = [];
    if (origin) parts.push('origem: ' + origin);
    if (utm.source) parts.push('utm_source: ' + utm.source);
    if (utm.campaign) parts.push('utm_campaign: ' + utm.campaign);
    return parts.length ? '[' + parts.join(' · ') + ']' : '';
  }
  function tagged(message) {
    const tag = sourceTag();
    const base = message || DEFAULT_MESSAGE;
    return tag ? base + '\n\n' + tag : base;
  }

  if (utm.source || utm.campaign) {
    document.querySelectorAll('a[data-keep-utm]').forEach(function (a) {
      try {
        const u = new URL(a.getAttribute('href'), window.location.href);
        if (u.origin !== window.location.origin) return;
        if (utm.source) u.searchParams.set('utm_source', utm.source);
        if (utm.campaign) u.searchParams.set('utm_campaign', utm.campaign);
        a.setAttribute('href', u.pathname + u.search + u.hash);
      } catch (e) {
        /* keep the original href */
      }
    });
  }

  // "5521974699723" -> "(21) 97469-9723"; números de outros países ficam como "+<dígitos>".
  function formatPhone(d) {
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
      const ddd = d.slice(2, 4);
      const n = d.slice(4);
      const cut = n.length - 4;
      return '(' + ddd + ') ' + n.slice(0, cut) + '-' + n.slice(cut);
    }
    return '+' + d;
  }

  function waLink(message) {
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(tagged(message));
  }

  function makeExternal(a, message) {
    a.href = waLink(message);
    a.target = '_blank';
    a.rel = 'noopener';
    if (!a.querySelector('.sr')) {
      const hint = document.createElement('span');
      hint.className = 'sr';
      hint.textContent = ' (abre o WhatsApp em nova aba)';
      a.appendChild(hint);
    }
  }

  if (digits) {
    document.querySelectorAll('[data-wa-cta]').forEach(function (a) {
      makeExternal(a, a.getAttribute('data-wa-msg'));
    });
    const pretty = formatPhone(digits);
    document.querySelectorAll('[data-wa-phone]').forEach(function (a) {
      a.textContent = pretty;
      makeExternal(a, a.getAttribute('data-wa-msg'));
    });
  }

  // ------------------------------------------------------------------ formulário que só monta a mensagem
  // "Olá! ... \nNome: Ana\nSegmento: Loja\nCidade: Niterói\n\n[origem: ...]"; campos vazios ficam de fora.
  document.querySelectorAll('form[data-wa-form]').forEach(function (form) {
    if (digits) form.setAttribute('action', 'https://wa.me/' + digits);
    const text = form.querySelector('input[name="text"]');
    const build = function () {
      const lines = [form.getAttribute('data-wa-msg') || DEFAULT_MESSAGE];
      form.querySelectorAll('[data-wa-field]').forEach(function (el) {
        const v = clean(el.value, 60);
        if (v) lines.push(el.getAttribute('data-wa-field') + ': ' + v);
      });
      return tagged(lines.join('\n'));
    };
    if (text) text.value = build();
    form.addEventListener('input', function () {
      if (text) text.value = build();
    });
    // a native GET submit would turn "\n" into "\r\n"; with JS, open the same wa.me link the buttons use
    form.addEventListener('submit', function (e) {
      if (text) text.value = build();
      if (!digits) return;
      e.preventDefault();
      const url = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(build());
      const win = window.open(url, '_blank');
      if (win) win.opener = null;
      else window.location.href = url;
    });
  });

  // ------------------------------------------------------------------ hero carousel: arrows + native scroll
  // A trilha rola nativamente (toque, trackpad e teclado). Nos aparelhos com ponteiro, os dois botões andam um card
  // por vez; aria-disabled marca os fins e o estado acompanha a rolagem. Sem autoplay, sem timer e sem dependência.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('[data-carousel]').forEach(function (box) {
    const track = box.querySelector('[data-carousel-track]');
    const prev = box.querySelector('[data-carousel-prev]');
    const next = box.querySelector('[data-carousel-next]');
    if (!track || !prev || !next) return;
    const cards = Array.prototype.slice.call(track.children);
    const cardStep = function () {
      if (cards.length < 2) return track.clientWidth;
      return cards[1].offsetLeft - cards[0].offsetLeft;
    };
    const maxScroll = function () {
      return Math.max(0, track.scrollWidth - track.clientWidth);
    };
    const update = function () {
      const max = maxScroll();
      box.classList.toggle('is-static', max <= 2);
      prev.setAttribute('aria-disabled', String(track.scrollLeft <= 2));
      next.setAttribute('aria-disabled', String(track.scrollLeft >= max - 2));
    };
    const go = function (direction) {
      const target = Math.max(0, Math.min(maxScroll(), track.scrollLeft + direction * cardStep()));
      if (typeof track.scrollTo === 'function') {
        track.scrollTo({ left: target, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      } else {
        track.scrollLeft = target;
      }
    };
    prev.addEventListener('click', function () {
      if (prev.getAttribute('aria-disabled') !== 'true') go(-1);
    });
    next.addEventListener('click', function () {
      if (next.getAttribute('aria-disabled') !== 'true') go(1);
    });
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    if (typeof reduceMotion.addEventListener === 'function') reduceMotion.addEventListener('change', update);
    update();
  });

  // ------------------------------------------------------------------ mobile menu
  const menuBtn = document.querySelector('[data-menu]');
  const nav = document.querySelector('[data-nav]');
  if (menuBtn && nav) {
    const label = menuBtn.querySelector('.sr');
    const icon = menuBtn.querySelector('use');
    const setOpen = function (open) {
      if (open) {
        const headBox = document.querySelector('[data-head]');
        const bottom = headBox ? Math.round(headBox.getBoundingClientRect().bottom) : 52;
        root.style.setProperty('--wa-nav-top', bottom + 'px');
      }
      menuBtn.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      root.classList.toggle('menu-open', open);
      if (label) label.textContent = open ? 'Fechar menu' : 'Abrir menu';
      if (icon) icon.setAttribute('href', open ? '#i-close' : '#i-menu');
    };
    menuBtn.addEventListener('click', function () {
      setOpen(menuBtn.getAttribute('aria-expanded') !== 'true');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menuBtn.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        menuBtn.focus({ preventScroll: true });
      }
    });
    window.matchMedia('(min-width: 960px)').addEventListener('change', function (mq) {
      if (mq.matches) setOpen(false);
    });
  }

  // ------------------------------------------------------------------ product tour tabs (WAI-ARIA tabs)
  // Automatic activation: arrows Left/Right (wrapping), Home and End move focus and select; Tab goes into the panel.
  // Deep links open the tab: #pausa, #midia, #instrucoes, #seg-clinica and the panel ids (#tp-pausa) select the tab
  // and scroll to the tour box, so the footer and linked pages reach the right tab.
  const tabBoxes = [];
  document.querySelectorAll('[data-tabs]').forEach(function (box) {
    const tabs = Array.prototype.slice.call(box.querySelectorAll('[role="tab"]'));
    const select = function (tab, focus) {
      tabs.forEach(function (t) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus({ preventScroll: true });
    };
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () {
        select(t, false);
      });
      t.addEventListener('keydown', function (e) {
        const last = tabs.length - 1;
        const next =
          e.key === 'ArrowRight' ? tabs[i === last ? 0 : i + 1]
          : e.key === 'ArrowLeft' ? tabs[i === 0 ? last : i - 1]
          : e.key === 'Home' ? tabs[0]
          : e.key === 'End' ? tabs[last]
          : null;
        if (next) {
          e.preventDefault();
          select(next, true);
        }
      });
    });
    tabBoxes.push({ box: box, tabs: tabs, select: select });
    const first = tabs.find(function (t) {
      return t.getAttribute('aria-selected') === 'true';
    }) || tabs[0];
    if (first) select(first, false);
  });
  const openHashTab = function () {
    let id = '';
    try {
      id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    } catch (e) {
      id = window.location.hash.replace(/^#/, '');
    }
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const wanted = target.closest('[role="tabpanel"]') || target;
    tabBoxes.some(function (entry) {
      const tab = entry.tabs.find(function (t) {
        const controls = t.getAttribute('aria-controls');
        return controls === wanted.id || t.id === wanted.id || controls === id || t.id === id;
      });
      if (!tab) return false;
      entry.select(tab, false);
      entry.box.scrollIntoView({ block: 'start' });
      return true;
    });
  };
  if (tabBoxes.length) {
    openHashTab();
    window.addEventListener('hashchange', openHashTab);
    // a link to the hash already in the URL fires no hashchange: open the tab anyway
    document.addEventListener('click', function (e) {
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (a && a.getAttribute('href') === window.location.hash) window.setTimeout(openHashTab, 0);
    });
  }

  // ------------------------------------------------------------------ example conversation (hero, data-demo)
  // Steps appear one by one; after the last one the next segment starts. Stops off screen and on the pause button.
  // With "reduce motion" (or when paused) every step is shown at once. Picking a tab by hand stops the auto-advance.
  document.querySelectorAll('[data-demo]').forEach(function (demo) {
    const tabs = Array.prototype.slice.call(demo.querySelectorAll('[role="tab"]'));
    const panels = tabs.map(function (t) {
      return document.getElementById(t.getAttribute('aria-controls'));
    });
    if (!tabs.length || panels.indexOf(null) >= 0) return;
    const toggle = demo.querySelector('[data-demo-toggle]');
    const toggleLabel = demo.querySelector('[data-demo-toggle-label]');
    let current = Math.max(0, tabs.findIndex(function (t) {
      return t.getAttribute('aria-selected') === 'true';
    }));
    let step = 0;
    let timer = 0;
    let paused = false;
    let onScreen = false;
    let auto = true;

    const steps = function (i) {
      return Array.prototype.slice.call(panels[i].querySelectorAll('[data-step]'));
    };
    const canAnimate = function () {
      return !reduceMotion.matches && !paused;
    };
    const stop = function () {
      window.clearTimeout(timer);
      timer = 0;
    };
    const showAll = function (i) {
      steps(i).forEach(function (el) {
        el.classList.add('is-in');
      });
    };
    const delayFor = function (el) {
      const words = (el.textContent || '').trim().split(/\s+/).length;
      return Math.min(2600, 700 + words * 55);
    };
    const tick = function () {
      timer = 0;
      if (!canAnimate() || !onScreen) return;
      const list = steps(current);
      if (step < list.length) {
        list[step].classList.add('is-in');
        step += 1;
        timer = window.setTimeout(tick, step < list.length ? delayFor(list[step]) : 4800);
      } else if (auto) {
        select((current + 1) % tabs.length, false, true);
      }
    };
    const start = function () {
      stop();
      demo.classList.toggle('is-anim', canAnimate());
      if (!canAnimate()) {
        showAll(current);
        return;
      }
      steps(current).forEach(function (el, k) {
        el.classList.toggle('is-in', k < step);
      });
      if (onScreen) timer = window.setTimeout(tick, step ? 600 : 500);
    };
    const select = function (i, focus, fromAuto) {
      tabs.forEach(function (t, k) {
        const on = k === i;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panels[k].hidden = !on;
      });
      if (!fromAuto) auto = false;
      current = i;
      step = 0;
      start();
      if (focus) tabs[i].focus({ preventScroll: true });
    };
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () {
        select(i, false);
      });
      t.addEventListener('keydown', function (e) {
        const last = tabs.length - 1;
        const next =
          e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
          : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1)
          : e.key === 'Home' ? 0
          : e.key === 'End' ? last
          : -1;
        if (next >= 0) {
          e.preventDefault();
          select(next, true);
        }
      });
    });
    const syncToggle = function () {
      if (!toggle) return;
      toggle.hidden = reduceMotion.matches;
      demo.classList.toggle('is-paused', paused);
      if (toggleLabel) toggleLabel.textContent = paused ? 'Retomar animação' : 'Pausar animação';
    };
    if (toggle) {
      toggle.addEventListener('click', function () {
        paused = !paused;
        syncToggle();
        if (!paused) step = 0;
        start();
      });
    }
    if (typeof reduceMotion.addEventListener === 'function') {
      reduceMotion.addEventListener('change', function () {
        syncToggle();
        start();
      });
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        if (!onScreen) stop();
        else if (!timer) start();
      }, { threshold: 0.25 }).observe(demo);
    } else {
      onScreen = true;
    }
    syncToggle();
    start();
  });

  // ------------------------------------------------------------------ measured status (data-status)
  // One GET /status, 3 s limit, no credentials. Shows the state measured now and how long the API took to answer.
  const statusBox = document.querySelector('[data-status]');
  if (statusBox && typeof window.fetch === 'function') {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const limit = window.setTimeout(function () {
      if (controller) controller.abort();
    }, 3000);
    const started = Date.now();
    window
      .fetch(STATUS_API, { credentials: 'omit', cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        return res.json();
      })
      .then(function (data) {
        window.clearTimeout(limit);
        const ms = Date.now() - started;
        const state = String(data && data.state || '');
        if (!data || typeof data.title !== 'string' || ['operational', 'degraded', 'outage'].indexOf(state) < 0) return;
        let total = 0;
        let ok = 0;
        (Array.isArray(data.groups) ? data.groups : []).forEach(function (g) {
          (Array.isArray(g.components) ? g.components : []).forEach(function (c) {
            if (!c || c.state === 'no_data') return;
            total += 1;
            if (c.state === 'operational') ok += 1;
          });
        });
        const parts = [];
        if (total) parts.push(ok + ' de ' + total + ' componentes funcionando');
        parts.push('a API respondeu em ' + ms.toLocaleString('pt-BR') + ' ms');
        statusBox.querySelector('[data-status-title]').textContent = data.title.slice(0, 80);
        statusBox.querySelector('[data-status-meta]').textContent = parts.join(' · ');
        statusBox.setAttribute('data-state', state);
        statusBox.hidden = false;
      })
      .catch(function () {
        window.clearTimeout(limit);
      });
  }

  // ------------------------------------------------------------------ announcement bar (data-annc)
  const annc = document.querySelector('[data-annc]');
  if (annc) {
    const close = annc.querySelector('[data-annc-close]');
    if (close) {
      close.addEventListener('click', function () {
        root.classList.add('annc-off');
        try {
          window.localStorage.setItem(ANNC_KEY, ANNC_VALUE);
        } catch (e) {
          /* not remembered: it comes back on the next visit */
        }
        const skip = document.querySelector('.wa-skip');
        const brand = document.querySelector('.wa-brand');
        if (brand) brand.focus({ preventScroll: true });
        else if (skip) skip.focus({ preventScroll: true });
      });
    }
  }

  // ------------------------------------------------------------------ mobile contact bar: only after the hero button scrolls away
  // and not over the contact section (it repeats the same button). Without IntersectionObserver it stays on, as before.
  const sticky = document.querySelector('.sticky-cta');
  if (sticky) {
    const heroBtn = document.querySelector('.hero .btn-lg');
    const contact = document.getElementById('contato');
    if (!heroBtn || !('IntersectionObserver' in window)) {
      sticky.classList.add('is-on');
    } else {
      let heroSeen = true;
      let contactSeen = false;
      const update = function () {
        sticky.classList.toggle('is-on', !heroSeen && !contactSeen);
      };
      new IntersectionObserver(function (entries) {
        const e = entries[0];
        heroSeen = e.isIntersecting || e.boundingClientRect.top > 0;
        update();
      }).observe(heroBtn);
      if (contact) {
        new IntersectionObserver(function (entries) {
          contactSeen = entries[0].isIntersecting;
          update();
        }).observe(contact);
      }
    }
  }

  // ------------------------------------------------------------------ header hairline after scrolling
  const head = document.querySelector('[data-head]');
  const hero = document.querySelector('[data-hero]') || document.querySelector('.hero');
  if (head && hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(
      function (entries) {
        head.classList.toggle('is-scrolled', !entries[0].isIntersecting);
      },
      { rootMargin: '-80px 0px 0px 0px' },
    ).observe(hero.querySelector('.hero-copy') || hero);
  }
})();
