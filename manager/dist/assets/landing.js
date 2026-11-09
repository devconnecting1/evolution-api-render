/*
 * WhatsAI: páginas públicas (manager/dist/landing/index.html, advocacia.html e instagram.html). JavaScript sem
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
 */
const CONTACT_WHATSAPP = '5521974699723';
const DEFAULT_MESSAGE = 'Olá! Vi o site do WhatsAI e quero agendar uma demonstração.';

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

  // ------------------------------------------------------------------ mobile menu
  const menuBtn = document.querySelector('[data-menu]');
  const nav = document.querySelector('[data-nav]');
  if (menuBtn && nav) {
    const label = menuBtn.querySelector('.sr');
    const icon = menuBtn.querySelector('use');
    const setOpen = function (open) {
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
        menuBtn.focus();
      }
    });
    window.matchMedia('(min-width: 960px)').addEventListener('change', function (mq) {
      if (mq.matches) setOpen(false);
    });
  }

  // ------------------------------------------------------------------ product tour tabs (WAI-ARIA tabs)
  // Automatic activation: arrows Left/Right (wrapping), Home and End move focus and select; Tab goes into the panel.
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
      if (focus) tab.focus();
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
  });

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
