/*
 * WhatsAI: comportamento do cabeçalho único (/, /seguranca, /termos e /privacidade).
 * Sem dependências, sem cookies, sem rastreadores e sem script inline (a CSP de manager/dist/vercel.json não abre
 * exceção). Faz só o que o cabeçalho precisa:
 *   - abre e fecha a gaveta no celular (aria-expanded, Escape, clique fora, foco preso, volta ao botão);
 *   - abre e fecha os menus de Produto e Segmentos no desktop e no celular;
 *   - marca o filete do topo quando a página sai do começo;
 *   - monta o link de WhatsApp do botão "Agendar demonstração" com a origem e os utm_* da URL.
 *
 * CONTATO: o número do WhatsApp fica só aqui. O landing.js lê window.WA_CONTACT_WHATSAPP, então mudar o número
 * neste arquivo vale para a landing e para as três páginas legais.
 */
(function () {
  'use strict';

  var CONTACT_WHATSAPP = '5521974699723';
  var DEFAULT_MESSAGE = 'Olá! Vi o site do WhatsAI e quero agendar uma demonstração.';
  window.WA_CONTACT_WHATSAPP = CONTACT_WHATSAPP;

  var root = document.documentElement;
  var head = document.querySelector('[data-head]');
  if (!head) return;

  var digits = String(CONTACT_WHATSAPP || '').replace(/\D/g, '');

  // ------------------------------------------------------------------ contato com origem e utm
  function clean(value, max) {
    var s = String(value == null ? '' : value);
    try {
      s = s.normalize('NFC').replace(/[^\p{L}\p{N} _.+-]/gu, ' ');
    } catch (e) {
      s = s.replace(/[^A-Za-z0-9 _.+-]/g, ' ');
    }
    return s.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  }

  var query;
  try {
    query = new URLSearchParams(window.location.search);
  } catch (e) {
    query = { get: function () { return null; } };
  }
  var utmSource = clean(query.get('utm_source'), 40);
  var utmCampaign = clean(query.get('utm_campaign'), 40);
  var origin = clean(document.body && document.body.getAttribute('data-wa-origin'), 40);

  function tagged(message) {
    var parts = [];
    if (origin) parts.push('origem: ' + origin);
    if (utmSource) parts.push('utm_source: ' + utmSource);
    if (utmCampaign) parts.push('utm_campaign: ' + utmCampaign);
    var base = message || DEFAULT_MESSAGE;
    return parts.length ? base + '\n\n[' + parts.join(' · ') + ']' : base;
  }

  if (digits) {
    document.querySelectorAll('[data-sh-wa]').forEach(function (a) {
      a.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(tagged(a.getAttribute('data-wa-msg')));
      a.target = '_blank';
      a.rel = 'noopener';
    });
  }

  // ------------------------------------------------------------------ gaveta do celular
  var menuBtn = head.querySelector('[data-sh-menu]');
  var nav = head.querySelector('[data-sh-nav]');
  var label = menuBtn && menuBtn.querySelector('.sr');
  var triggers = Array.prototype.slice.call(head.querySelectorAll('[data-sh-trigger]'));
  var firstLink = nav && nav.querySelector('a, button');

  function setMenu(open, focusFirst) {
    if (!menuBtn || !nav) return;
    menuBtn.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
    head.classList.toggle('menu-open', open);
    root.classList.toggle('menu-open', open);
    if (label) label.textContent = open ? 'Fechar menu' : 'Abrir menu';
    if (!open) closeMegas();
    if (open && focusFirst && firstLink) {
      window.setTimeout(function () {
        firstLink.focus();
      }, 0);
    }
  }

  function menuOpen() {
    return !!menuBtn && menuBtn.getAttribute('aria-expanded') === 'true';
  }

  if (menuBtn && nav) {
    menuBtn.addEventListener('click', function () {
      setMenu(!menuOpen(), !menuOpen());
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
  }

  // ------------------------------------------------------------------ menus de Produto e Segmentos
  function closeMegas(except) {
    triggers.forEach(function (btn) {
      if (btn === except) return;
      btn.setAttribute('aria-expanded', 'false');
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (panel) panel.hidden = true;
    });
  }

  triggers.forEach(function (btn) {
    var panel = document.getElementById(btn.getAttribute('aria-controls'));
    if (!panel) return;
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      closeMegas(btn);
      btn.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
    });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && btn.getAttribute('aria-expanded') !== 'true') {
        e.preventDefault();
        btn.click();
        var first = panel.querySelector('a');
        if (first) first.focus();
      }
    });
  });

  document.addEventListener('click', function (e) {
    if (!head.contains(e.target)) {
      closeMegas();
      if (menuOpen()) setMenu(false);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var openTrigger = triggers.filter(function (btn) {
      return btn.getAttribute('aria-expanded') === 'true';
    })[0];
    if (openTrigger) {
      closeMegas();
      openTrigger.focus();
      return;
    }
    if (menuOpen()) {
      setMenu(false);
      if (menuBtn) menuBtn.focus();
    }
  });

  // Tab preso na gaveta enquanto ela está aberta.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !menuOpen() || !nav) return;
    var items = Array.prototype.slice
      .call(head.querySelectorAll('a[href], button:not([disabled])'))
      .filter(function (el) {
        return el.offsetParent !== null;
      });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  window.matchMedia('(min-width: 960px)').addEventListener('change', function (mq) {
    if (mq.matches) setMenu(false);
  });

  // ------------------------------------------------------------------ filete do topo
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      head.classList.toggle('is-scrolled', window.scrollY > 6);
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
