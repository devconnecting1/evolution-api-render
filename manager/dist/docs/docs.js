/*
 * WhatsAI: comportamento da documentação pública (/docs).
 * Sem dependências, sem framework e sem script inline (a CSP de manager/dist/vercel.json não abre exceção).
 * Tema padrão Sistema, persistido em localStorage; drawer abaixo de 1024 px; busca local sem servidor;
 * índice ativo por rolagem; cópia dos blocos de código; atalhos de teclado e foco visível.
 */
(function () {
  'use strict';

  var THEME_KEY = 'wa-theme';
  var root = document.documentElement;
  var THEMES = ['system', 'light', 'dark'];

  /* Aplica o tema salvo antes da primeira pintura, evitando o flash claro/escuro. */
  function storedTheme() {
    try {
      var value = window.localStorage.getItem(THEME_KEY);
      return THEMES.indexOf(value) >= 0 ? value : 'system';
    } catch (error) {
      return 'system';
    }
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
        /* navegador sem armazenamento: o tema vale só nesta visita */
      }
    }
    updateThemeUi(mode);
  }

  function systemIsDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function effectiveTheme(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return systemIsDark() ? 'dark' : 'light';
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
    var meta = document.querySelector('[data-theme-color]');
    if (meta) {
      meta.setAttribute('content', effectiveTheme(mode) === 'dark' ? '#10100e' : '#f5f5f5');
    }
  }

  applyTheme(storedTheme(), false);

  /* ------------------------------------------------------------------------------------------------ tema */
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

    document.addEventListener('focusin', function (event) {
      if (!wrap.contains(event.target)) closeMenu(false);
    });

    if (window.matchMedia) {
      var query = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (storedTheme() === 'system') updateThemeUi('system');
      };
      if (query.addEventListener) query.addEventListener('change', onChange);
      else if (query.addListener) query.addListener(onChange);
    }
  }

  /* ---------------------------------------------------------------------------------------------- drawer */
  function initDrawer() {
    var toggle = document.querySelector('[data-drawer-toggle]');
    var sidebar = document.querySelector('[data-sidebar]');
    var close = document.querySelector('[data-drawer-close]');
    var scrim = document.querySelector('[data-scrim]');
    if (!toggle || !sidebar) return;

    function isOpen() {
      return root.classList.contains('drawer-open');
    }

    function openDrawer() {
      root.classList.add('drawer-open');
      toggle.setAttribute('aria-expanded', 'true');
      if (scrim) scrim.hidden = false;
      var first = sidebar.querySelector('[data-drawer-close]') || sidebar.querySelector('a, button');
      if (first) {
        window.requestAnimationFrame(function () {
          first.focus();
        });
      }
    }

    function closeDrawer(returnFocus) {
      if (!isOpen()) return;
      root.classList.remove('drawer-open');
      toggle.setAttribute('aria-expanded', 'false');
      if (scrim) scrim.hidden = true;
      if (returnFocus) toggle.focus();
    }

    toggle.addEventListener('click', function () {
      if (isOpen()) closeDrawer(true);
      else openDrawer();
    });

    if (close) close.addEventListener('click', function () { closeDrawer(true); });
    if (scrim) scrim.addEventListener('click', function () { closeDrawer(true); });

    sidebar.addEventListener('click', function (event) {
      if (event.target.closest('a') && window.matchMedia('(max-width: 1023px)').matches) {
        closeDrawer(false);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (!isOpen()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer(true);
        return;
      }
      if (event.key !== 'Tab') return;
      var focusables = sidebar.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    if (window.matchMedia) {
      var desktop = window.matchMedia('(min-width: 1024px)');
      var onDesktop = function () {
        if (desktop.matches) closeDrawer(false);
      };
      if (desktop.addEventListener) desktop.addEventListener('change', onDesktop);
      else if (desktop.addListener) desktop.addListener(onDesktop);
    }
  }

  /* ----------------------------------------------------------------------------------------------- busca */
  function fold(text) {
    var normalized = text.normalize('NFD');
    var out = '';
    for (var i = 0; i < normalized.length; i++) {
      var code = normalized.charCodeAt(i);
      if (code >= 0x0300 && code <= 0x036f) continue;
      out += normalized.charAt(i);
    }
    return out.toLowerCase();
  }

  function foldWithMap(text) {
    var out = '';
    var map = [];
    for (var i = 0; i < text.length; i++) {
      var piece = fold(text.charAt(i));
      for (var j = 0; j < piece.length; j++) {
        out += piece.charAt(j);
        map.push(i);
      }
    }
    return { text: out, map: map };
  }

  function queryTokens(value) {
    return fold(value)
      .split(/\s+/)
      .filter(function (token) { return token.length > 0; });
  }

  function matchesAll(haystack, tokens) {
    for (var i = 0; i < tokens.length; i++) {
      if (haystack.indexOf(tokens[i]) === -1) return false;
    }
    return true;
  }

  function highlight(container, text, tokens) {
    var folded = foldWithMap(text);
    var ranges = [];
    tokens.forEach(function (token) {
      var from = 0;
      var index = folded.text.indexOf(token, from);
      while (index !== -1) {
        ranges.push([folded.map[index], folded.map[index + token.length - 1] + 1]);
        from = index + token.length;
        index = folded.text.indexOf(token, from);
      }
    });
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    ranges.forEach(function (range) {
      var last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([range[0], range[1]]);
    });
    if (!merged.length) {
      container.textContent = text;
      return;
    }
    var cursor = 0;
    merged.forEach(function (range) {
      if (range[0] > cursor) container.appendChild(document.createTextNode(text.slice(cursor, range[0])));
      var mark = document.createElement('mark');
      mark.textContent = text.slice(range[0], range[1]);
      container.appendChild(mark);
      cursor = range[1];
    });
    if (cursor < text.length) container.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function sectionEntries() {
    var entries = [];
    var sections = document.querySelectorAll('[data-section]');
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      var h2 = section.querySelector('h2');
      var title = section.getAttribute('data-title') || (h2 ? h2.textContent.trim() : section.id);
      var fullText = fold(section.textContent || '');
      entries.push({
        id: section.id,
        title: title,
        parent: 'Documentação',
        text: fullText,
        isSection: true,
        sectionId: section.id
      });
      var subs = section.querySelectorAll('h3[id]');
      for (var j = 0; j < subs.length; j++) {
        var sub = subs[j];
        var buffer = [];
        var node = sub.nextElementSibling;
        while (node && !/^H[23]$/.test(node.tagName)) {
          buffer.push(node.textContent || '');
          node = node.nextElementSibling;
        }
        entries.push({
          id: sub.id,
          title: sub.textContent.trim(),
          parent: title,
          text: fold(buffer.join(' ')),
          isSection: false,
          sectionId: section.id
        });
      }
    }
    return entries;
  }

  function initSearch() {
    var input = document.querySelector('[data-search-input]');
    var form = document.querySelector('[data-search-form]');
    var panel = document.querySelector('[data-search-panel]');
    var list = document.querySelector('[data-search-list]');
    var count = document.querySelector('[data-search-count]');
    var empty = document.querySelector('[data-search-empty]');
    var clear = document.querySelector('[data-search-clear]');
    var sideLinks = document.querySelectorAll('[data-nav-link]');
    var sideGroups = document.querySelectorAll('[data-side-group]');
    var sideEmpty = document.querySelector('[data-side-empty]');
    if (!input || !panel || !list) return;

    var entries = sectionEntries();
    var titlesBySection = {};
    entries.forEach(function (entry) {
      if (!titlesBySection[entry.sectionId]) titlesBySection[entry.sectionId] = [];
      titlesBySection[entry.sectionId].push(fold(entry.title));
    });

    var selectedIndex = -1;
    var results = [];

    function closePanel() {
      panel.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      selectedIndex = -1;
    }

    function openPanel() {
      if (!input.value.trim()) {
        closePanel();
        return;
      }
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function select(index) {
      var links = list.querySelectorAll('a');
      if (!links.length) return;
      selectedIndex = (index + links.length) % links.length;
      for (var i = 0; i < links.length; i++) {
        links[i].setAttribute('aria-selected', i === selectedIndex ? 'true' : 'false');
      }
      input.setAttribute('aria-activedescendant', links[selectedIndex].id);
      links[selectedIndex].scrollIntoView({ block: 'nearest' });
    }

    function filterSidebar(tokens) {
      var anyVisible = false;
      for (var g = 0; g < sideGroups.length; g++) {
        var group = sideGroups[g];
        var groupVisible = false;
        var links = group.querySelectorAll('[data-nav-link]');
        for (var i = 0; i < links.length; i++) {
          var id = (links[i].getAttribute('href') || '').replace('#', '');
          var titles = (titlesBySection[id] || []).join(' ');
          var visible = !tokens.length || matchesAll(titles + ' ' + fold(links[i].textContent || ''), tokens);
          links[i].parentElement.hidden = !visible;
          if (visible) groupVisible = true;
        }
        group.hidden = !groupVisible;
        if (groupVisible) anyVisible = true;
      }
      if (sideEmpty) sideEmpty.hidden = anyVisible;
    }

    function render(query) {
      var tokens = queryTokens(query);
      filterSidebar(tokens);
      list.textContent = '';
      selectedIndex = -1;
      if (!tokens.length) {
        results = [];
        if (count) count.textContent = '';
        if (empty) empty.hidden = true;
        closePanel();
        return;
      }
      var foldedQuery = tokens.join(' ');
      results = entries
        .filter(function (entry) {
          return matchesAll(entry.title === '' ? '' : fold(entry.title) + ' ' + fold(entry.parent) + ' ' + entry.text, tokens);
        })
        .map(function (entry) {
          var title = fold(entry.title);
          var parent = fold(entry.parent);
          var score = 0;
          if (title === foldedQuery) score += 120;
          else if (title.indexOf(foldedQuery) === 0) score += 90;
          else if (title.indexOf(tokens[0]) !== -1) score += 50;
          if (matchesAll(title, tokens)) score += 40;
          if (matchesAll(parent, tokens)) score += 20;
          if (entry.isSection) score += 4;
          score -= Math.min(title.length, 80) / 100;
          return { entry: entry, score: score };
        })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, 10);

      if (!results.length) {
        if (count) count.textContent = '0 resultados';
        if (empty) empty.hidden = false;
        openPanel();
        return;
      }

      if (empty) empty.hidden = true;
      if (count) count.textContent = results.length + (results.length === 1 ? ' resultado' : ' resultados');

      results.forEach(function (result, index) {
        var item = document.createElement('li');
        item.setAttribute('role', 'presentation');
        var link = document.createElement('a');
        link.href = '#' + result.entry.id;
        link.id = 'search-option-' + index;
        link.setAttribute('role', 'option');
        link.setAttribute('aria-selected', 'false');
        var title = document.createElement('span');
        title.className = 'sr-title';
        highlight(title, result.entry.title, tokens);
        var parent = document.createElement('span');
        parent.className = 'sr-parent';
        parent.textContent = result.entry.parent;
        link.appendChild(title);
        link.appendChild(parent);
        link.addEventListener('click', function () {
          closePanel();
        });
        item.appendChild(link);
        list.appendChild(item);
      });
      openPanel();
    }

    var renderTimer = null;
    input.addEventListener('input', function () {
      if (clear) clear.hidden = !input.value;
      if (renderTimer) window.clearTimeout(renderTimer);
      renderTimer = window.setTimeout(function () { render(input.value); }, 80);
    });

    input.addEventListener('focus', function () {
      if (input.value.trim() && !panel.hidden) return;
      if (input.value.trim()) render(input.value);
    });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (panel.hidden) {
          render(input.value);
          if (!panel.hidden) select(0);
        } else if (results.length) {
          select(selectedIndex + 1);
        }
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!panel.hidden && results.length) select(selectedIndex - 1);
      } else if (event.key === 'Enter') {
        if (!panel.hidden && selectedIndex >= 0) {
          event.preventDefault();
          var active = list.querySelectorAll('a')[selectedIndex];
          if (active) {
            closePanel();
            window.location.hash = active.getAttribute('href');
          }
        }
      } else if (event.key === 'Escape') {
        if (!panel.hidden) {
          event.preventDefault();
          closePanel();
        } else if (input.value) {
          event.preventDefault();
          input.value = '';
          if (clear) clear.hidden = true;
          render('');
        }
      }
    });

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (results.length) {
          var first = list.querySelector('a');
          if (first) {
            closePanel();
            window.location.hash = first.getAttribute('href');
          }
        }
      });
    }

    if (clear) {
      clear.addEventListener('click', function () {
        input.value = '';
        clear.hidden = true;
        render('');
        input.focus();
      });
    }

    document.addEventListener('click', function (event) {
      var search = document.querySelector('[data-search-root]');
      if (search && !search.contains(event.target)) closePanel();
    });

    document.addEventListener('keydown', function (event) {
      var target = event.target;
      var typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      var isSlash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey;
      var isCommandK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if ((isSlash && !typing) || isCommandK) {
        event.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  /* -------------------------------------------------------------------------------------------- índice */
  function initScrollSpy() {
    var sections = Array.prototype.slice.call(document.querySelectorAll('[data-section]'));
    var links = Array.prototype.slice.call(document.querySelectorAll('[data-nav-link], [data-toc-link]'));
    if (!sections.length || !links.length) return;

    var current = '';
    var frame = null;

    function topOffset() {
      var bar = document.querySelector('.topbar');
      return (bar ? bar.getBoundingClientRect().height : 60) + 36;
    }

    function update() {
      frame = null;
      var offset = topOffset();
      var active = sections[0].id;
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].getBoundingClientRect().top <= offset) active = sections[i].id;
      }
      var atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 4;
      if (atBottom) active = sections[sections.length - 1].id;
      if (active === current) return;
      current = active;
      links.forEach(function (link) {
        var id = (link.getAttribute('href') || '').replace('#', '');
        var activeLink = id === active;
        if (activeLink) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
    }

    function request() {
      if (frame === null) frame = window.requestAnimationFrame(update);
    }

    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    window.addEventListener('hashchange', request);
    update();
  }

  /* ---------------------------------------------------------------------------------------------- cópia */
  function initCopy() {
    var buttons = document.querySelectorAll('[data-copy]');
    var status = document.querySelector('[data-copy-status]');
    var timers = new WeakMap();

    function announce(message) {
      if (!status) return;
      status.textContent = '';
      window.setTimeout(function () { status.textContent = message; }, 30);
    }

    function fallback(text) {
      var area = document.createElement('textarea');
      area.className = 'sr';
      area.value = text;
      area.setAttribute('readonly', '');
      document.body.appendChild(area);
      area.select();
      var copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        copied = false;
      }
      document.body.removeChild(area);
      return copied;
    }

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var block = button.closest('.code-block');
        var code = block ? block.querySelector('pre code') : null;
        if (!code) return;
        var text = code.textContent.replace(/\s+$/, '');
        var done = function () {
          button.classList.add('is-done');
          var label = button.querySelector('.copy-label');
          if (label) label.textContent = 'Copiado';
          announce('Código copiado para a área de transferência.');
          var previous = timers.get(button);
          if (previous) window.clearTimeout(previous);
          timers.set(
            button,
            window.setTimeout(function () {
              button.classList.remove('is-done');
              if (label) label.textContent = 'Copiar';
            }, 1800)
          );
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {
            if (fallback(text)) done();
            else announce('Não foi possível copiar. Selecione o código e copie manualmente.');
          });
        } else if (fallback(text)) {
          done();
        } else {
          announce('Não foi possível copiar. Selecione o código e copie manualmente.');
        }
      });
    });
  }

  function init() {
    initTheme();
    initDrawer();
    initSearch();
    initScrollSpy();
    initCopy();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
