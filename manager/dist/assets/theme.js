/*
 * WhatsAI: tema Sistema / Claro / Escuro das paginas com o cabecalho global (landing).
 * Sem dependencias e sem script inline. Aplica o tema salvo antes da primeira pintura para nao piscar.
 * As cores vem de assets/tokens.css; este arquivo so cuida do atributo data-theme-mode, do menu e do theme-color.
 * As paginas legais usam o mesmo menu pelo docs.js, que ja tem esta logica; por isso este arquivo nao e carregado la.
 */
(function () {
  'use strict';

  var THEME_KEY = 'wa-theme';
  var root = document.documentElement;
  var THEMES = ['system', 'light', 'dark'];

  function storedTheme() {
    try {
      var value = window.localStorage.getItem(THEME_KEY);
      return THEMES.indexOf(value) >= 0 ? value : 'system';
    } catch (error) {
      return 'system';
    }
  }

  function systemIsDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function effectiveTheme(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return systemIsDark() ? 'dark' : 'light';
  }

  function updateMeta(mode) {
    var meta = document.querySelector('[data-theme-color]');
    if (meta) meta.setAttribute('content', effectiveTheme(mode) === 'dark' ? '#0d0d0d' : '#ffffff');
  }

  function updateThemeUi(mode) {
    var button = document.querySelector('[data-theme-toggle]');
    if (button) {
      var names = { system: 'Sistema', light: 'Claro', dark: 'Escuro' };
      button.setAttribute('aria-label', 'Tema: ' + (names[mode] || 'Sistema'));
    }
    var options = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < options.length; i++) {
      options[i].setAttribute('aria-checked', options[i].getAttribute('data-theme-set') === mode ? 'true' : 'false');
    }
    updateMeta(mode);
  }

  function applyTheme(mode, persist) {
    if (mode === 'light' || mode === 'dark') {
      root.setAttribute('data-theme-mode', mode);
    } else {
      root.removeAttribute('data-theme-mode');
    }
    if (persist) {
      try {
        if (mode === 'system') {
          window.localStorage.removeItem(THEME_KEY);
        } else {
          window.localStorage.setItem(THEME_KEY, mode);
        }
      } catch (error) {
        /* navegador sem armazenamento: o tema vale so nesta visita */
      }
    }
    updateThemeUi(mode);
  }

  applyTheme(storedTheme(), false);

  function initTheme() {
    var wrap = document.querySelector('[data-theme]');
    var button = document.querySelector('[data-theme-toggle]');
    var menu = document.querySelector('[data-theme-menu]');
    if (!wrap || !button || !menu) return;

    var current = storedTheme();
    updateThemeUi(current);

    function openMenu() {
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      var checked = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
      if (checked) checked.focus();
    }

    function closeMenu(returnFocus) {
      if (menu.hidden) return;
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (returnFocus) button.focus();
    }

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu(true);
    });

    menu.addEventListener('click', function (event) {
      var choice = event.target.closest('[data-theme-set]');
      if (!choice) return;
      current = choice.getAttribute('data-theme-set');
      applyTheme(current, true);
      closeMenu(true);
    });

    menu.addEventListener('keydown', function (event) {
      var items = Array.prototype.slice.call(menu.querySelectorAll('[data-theme-set]'));
      var index = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        items[(index + 1 + items.length) % items.length].focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        items[(index - 1 + items.length) % items.length].focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        items[0].focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      } else if (event.key === 'Tab') {
        closeMenu(false);
      }
    });

    document.addEventListener('click', function (event) {
      if (!wrap.contains(event.target)) closeMenu(false);
    });

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (storedTheme() === 'system') updateThemeUi('system');
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
})();
