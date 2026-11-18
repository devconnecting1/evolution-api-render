/*
 * WhatsAI: tema da pagina de status (Sistema, Claro ou Escuro), igual ao da documentacao.
 * Carregado no <head> sem defer para aplicar o tema salvo antes da primeira pintura (sem flash). Sem script inline:
 * a CSP de vercel.json nao abre excecao. A preferencia fica em localStorage "wa-theme", a mesma chave do site e da
 * documentacao.
 */
(function () {
  'use strict';

  var KEY = 'wa-theme';
  var MODES = ['system', 'light', 'dark'];
  var NAMES = { system: 'Sistema', light: 'Claro', dark: 'Escuro' };
  var COLORS = { light: '#ffffff', dark: '#0d0d0d' };
  var root = document.documentElement;

  function stored() {
    try {
      var value = window.localStorage.getItem(KEY);
      return MODES.indexOf(value) >= 0 ? value : 'system';
    } catch (error) {
      return 'system';
    }
  }

  function apply(mode) {
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme-mode', mode);
    else root.removeAttribute('data-theme-mode');
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var media = metas[i].getAttribute('data-media') || metas[i].getAttribute('media') || '';
      if (!metas[i].getAttribute('data-media')) metas[i].setAttribute('data-media', media);
      if (mode === 'system') {
        metas[i].setAttribute('media', metas[i].getAttribute('data-media'));
      } else {
        metas[i].removeAttribute('media');
        metas[i].setAttribute('content', COLORS[mode]);
      }
    }
  }

  function save(mode) {
    try {
      if (mode === 'system') window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, mode);
    } catch (error) {
      // navegador sem armazenamento: o tema vale so nesta visita
    }
  }

  apply(stored());

  function wire() {
    var buttons = document.querySelectorAll('[data-st-theme]');
    function sync(mode) {
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].setAttribute('aria-pressed', buttons[i].getAttribute('data-st-theme') === mode ? 'true' : 'false');
      }
      var group = document.querySelector('.st-theme');
      if (group) group.setAttribute('aria-label', 'Tema: ' + NAMES[mode]);
    }
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (event) {
        var mode = event.currentTarget.getAttribute('data-st-theme');
        if (MODES.indexOf(mode) < 0) return;
        root.classList.add('theme-switching');
        apply(mode);
        save(mode);
        sync(mode);
        window.setTimeout(function () {
          root.classList.remove('theme-switching');
        }, 60);
      });
    }
    sync(stored());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
