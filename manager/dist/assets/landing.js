/*
 * WhatsAI: página inicial (manager/dist/landing/index.html). JavaScript sem dependências, sem cookies e sem
 * rastreadores.
 *
 * CONTATO: o número fica em um lugar só, no assets/site-header.js (window.WA_CONTACT_WHATSAPP), compartilhado com
 * /seguranca, /termos e /privacidade. Aqui ele apenas preenche os links data-wa-cta (botões de demonstração) e
 * data-wa-phone (rodapé). Sem número, os links continuam rolando até #contato.
 *
 * ORIGEM DO CONTATO: <body data-wa-origin="site"> faz a mensagem do WhatsApp terminar com "[origem: site]". Se a URL
 * tiver ?utm_source= e/ou ?utm_campaign=, os valores entram na mesma linha, limpos e com no máximo 40 caracteres.
 *
 * BARRA DO CELULAR: aparece depois que o botão do herói sai da tela e some quando a seção #contato está visível,
 * para não cobrir o mesmo botão. Sem IntersectionObserver, começa visível.
 *
 * O topo (gaveta, menus e filete) e os links do topo ficam em site-header.js.
 */
(function () {
  'use strict';

  var CONTACT_WHATSAPP = String(window.WA_CONTACT_WHATSAPP || '');
  var DEFAULT_MESSAGE = 'Olá! Vi o site do WhatsAI e quero agendar uma demonstração.';
  var digits = CONTACT_WHATSAPP.replace(/\D/g, '');

  // ------------------------------------------------------------------ origem + utm (só no texto da mensagem)
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
  var utm = { source: clean(query.get('utm_source'), 40), campaign: clean(query.get('utm_campaign'), 40) };
  var origin = clean(document.body && document.body.getAttribute('data-wa-origin'), 40);

  function tagged(message) {
    var parts = [];
    if (origin) parts.push('origem: ' + origin);
    if (utm.source) parts.push('utm_source: ' + utm.source);
    if (utm.campaign) parts.push('utm_campaign: ' + utm.campaign);
    var base = message || DEFAULT_MESSAGE;
    return parts.length ? base + '\n\n[' + parts.join(' · ') + ']' : base;
  }

  // "5521974699723" -> "(21) 97469-9723"; números de outros países ficam como "+<dígitos>".
  function formatPhone(d) {
    if (d.indexOf('55') === 0 && (d.length === 12 || d.length === 13)) {
      var ddd = d.slice(2, 4);
      var n = d.slice(4);
      var cut = n.length - 4;
      return '(' + ddd + ') ' + n.slice(0, cut) + '-' + n.slice(cut);
    }
    return '+' + d;
  }

  function makeExternal(a, message) {
    a.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(tagged(message));
    a.target = '_blank';
    a.rel = 'noopener';
    if (!a.querySelector('.sr')) {
      var hint = document.createElement('span');
      hint.className = 'sr';
      hint.textContent = ' (abre o WhatsApp em nova aba)';
      a.appendChild(hint);
    }
  }

  if (digits) {
    document.querySelectorAll('[data-wa-cta]').forEach(function (a) {
      makeExternal(a, a.getAttribute('data-wa-msg'));
    });
    var pretty = formatPhone(digits);
    document.querySelectorAll('[data-wa-phone]').forEach(function (a) {
      a.textContent = pretty;
      makeExternal(a, a.getAttribute('data-wa-msg'));
    });
  }

  // ------------------------------------------------------------------ barra do celular
  var sticky = document.querySelector('.sticky-cta');
  if (sticky) {
    var heroBtn = document.querySelector('.hero .btn-lg');
    var contact = document.getElementById('contato');
    if (!heroBtn || !('IntersectionObserver' in window)) {
      sticky.classList.add('is-on');
    } else {
      var heroSeen = true;
      var contactSeen = false;
      var update = function () {
        sticky.classList.toggle('is-on', !heroSeen && !contactSeen);
      };
      new IntersectionObserver(function (entries) {
        var e = entries[0];
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
})();
