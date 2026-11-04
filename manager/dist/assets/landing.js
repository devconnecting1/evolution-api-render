/*
 * WhatsAI: página inicial (manager/dist/landing/index.html). JavaScript sem dependências.
 *
 * CONTATO: troque o número só aqui. Formato internacional, apenas dígitos (55 + DDD + número).
 * Vazio ('') = os botões "Agendar demonstração" / "Falar no WhatsApp" apenas rolam até a seção de contato.
 */
const CONTACT_WHATSAPP = '5521974699723';
const DEFAULT_MESSAGE = 'Olá! Vi o site do WhatsAI e quero agendar uma demonstração.';

(function () {
  'use strict';
  const root = document.documentElement;
  root.classList.add('js');

  const digits = String(CONTACT_WHATSAPP || '').replace(/\D/g, '');

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
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message || DEFAULT_MESSAGE);
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
  const hero = document.querySelector('.hero');
  if (head && hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(
      function (entries) {
        head.classList.toggle('is-scrolled', !entries[0].isIntersecting);
      },
      { rootMargin: '-80px 0px 0px 0px' },
    ).observe(hero.querySelector('.hero-copy') || hero);
  }
})();
