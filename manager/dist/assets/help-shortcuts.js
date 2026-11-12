/*
 * WhatsAI Manager: atalhos de teclado globais e ponte com o menu Ajuda (manager/patches/help-menu.py, proposta W).
 *
 *   ?      abre o diálogo "Atalhos do teclado" (o componente WaHelp escuta o evento wa-help:shortcuts)
 *   G + C  vai para Conversas da instância aberta
 *   G + L  vai para Leads da instância aberta
 *   P      na conversa aberta, abre o painel do contato e aciona "Pausar IA" / "Retomar IA"; a confirmação
 *          continua sendo do usuário, como no botão do painel
 *   Esc    fecha os menus e diálogos abertos; quem trata é o próprio componente (Radix Dialog e os menus do
 *          painel já fecham com Esc), por isso este script não intercepta a tecla
 *
 * Regras: nada de atalho com Ctrl/⌘/Alt (o Ctrl K do painel continua só dele) e nada dentro de campos de texto
 * (input, textarea, select, contenteditable e combobox). Também não dispara com um diálogo ou o menu Ajuda aberto.
 * Só navega quando a URL já está dentro de uma instância (/manager/instance/<id>/...). Não faz requisição, não lê
 * nem grava dados: clica no link que a própria sidebar já tem e, se ele não existir, usa o history do navegador.
 */
(function () {
  'use strict';

  var SEQUENCE_MS = 1500;
  var pending = '';
  var pendingTimer = null;

  function text(el) {
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function isEditable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    var tag = String(el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    var role = el.getAttribute && el.getAttribute('role');
    return role === 'textbox' || role === 'searchbox' || role === 'combobox';
  }

  function isOpen() {
    if (document.querySelector('[data-wa-help-menu]')) return true;
    var dialogs = document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
    for (var i = 0; i < dialogs.length; i++) {
      if (dialogs[i].getAttribute('aria-hidden') !== 'true') return true;
    }
    return false;
  }

  function clearPending() {
    pending = '';
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function instanceId() {
    var m = String(location.pathname || '').match(/^\/manager\/instance\/([^/]+)\//);
    if (!m) return '';
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return m[1];
    }
  }

  function go(path) {
    var id = instanceId();
    if (!id) return false;
    var href = '/manager/instance/' + encodeURIComponent(id) + path;
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('href') === href) {
        links[i].click();
        return true;
      }
    }
    try {
      history.pushState({}, '', href);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return true;
    } catch (e) {
      location.assign(href);
      return true;
    }
  }

  function findAiButton() {
    var panel = document.getElementById('wa-tw-panel');
    if (!panel) return null;
    var buttons = panel.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var label = text(buttons[i]);
      if (label === 'Pausar IA' || label === 'Retomar IA') return buttons[i];
    }
    return null;
  }

  function aiAction() {
    if (!/^\/manager\/instance\/[^/]+\/chat\/.+/.test(String(location.pathname || ''))) return false;
    var info = document.getElementById('wa-tw-info');
    if (!info) return false;
    var panel = document.getElementById('wa-tw-panel');
    if (!panel) info.click();
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var button = findAiButton();
      if (button) {
        clearInterval(timer);
        button.click();
        return;
      }
      if (tries >= 30) clearInterval(timer);
    }, 100);
    return true;
  }

  function onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditable(e.target) || isEditable(document.activeElement)) return;
    if (isOpen()) return;

    var question = e.key === '?' || (e.key === '/' && e.shiftKey);
    if (question) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('wa-help:shortcuts'));
      return;
    }

    var key = String(e.key || '');
    if (key === 'g' || key === 'G') {
      pending = 'g';
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(clearPending, SEQUENCE_MS);
      return;
    }

    if (pending === 'g') {
      var next = key.toLowerCase();
      if (next === 'c' || next === 'l') {
        clearPending();
        if (go(next === 'c' ? '/chat' : '/leads')) e.preventDefault();
        return;
      }
      clearPending();
      return;
    }

    if ((key === 'p' || key === 'P') && aiAction()) e.preventDefault();
  }

  if (window.addEventListener) window.addEventListener('keydown', onKey, false);
})();
