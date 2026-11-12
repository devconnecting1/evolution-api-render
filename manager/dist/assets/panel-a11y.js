/*
 * WhatsAI panel: small accessibility and orientation fixes applied to the rendered page (proposal Q).
 *
 * - Tab title per page: "Leads · Loja Exemplo · WhatsAI" instead of "WhatsAI" everywhere, so several open tabs and
 *   the browser history can be told apart (Twenty, Linear and Cal.com do the same).
 * - One main landmark per page: pages that render no <main> get role="main" on their content area, so screen readers
 *   can jump straight to the content.
 * - Switches without a name (Webhook, WebSocket, RabbitMQ, SQS: one per event) get the text of their row as name;
 *   before, a screen reader announced only "botão".
 * - Status dots with aria-label get role="img" (aria-label is not allowed on a plain span); the Ctrl K hint inside
 *   the search button is hidden from assistive technology so the button name matches its visible text; sidebar
 *   section labels drop role="none" so the list contains only list items.
 *
 * Runs on every panel page (administrator and client portal). Reads and writes attributes only; it never changes
 * what the page does. Re-applied after each render through a MutationObserver, throttled to one pass per frame.
 */
(function () {
  'use strict';

  var BRAND = 'WhatsAI';

  function text(el) {
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function pageTitle() {
    var heading =
      document.querySelector('main h1, [role="main"] h1') ||
      document.querySelector('h1.wa-page-title, .wa-ut-title, h1');
    var page = text(heading);
    var inst = text(document.querySelector('.wa-tw-crumb-inst a, .wa-tw-crumb-inst'));
    var parts = [];
    if (page) parts.push(page);
    if (inst && inst !== page) parts.push(inst);
    parts.push(BRAND);
    var next = parts.join(' · ');
    if (document.title !== next) document.title = next;
  }

  function mainLandmark() {
    var ours = document.querySelector('[data-wa-main]');
    var native = document.querySelector('main');
    if (ours && native) {
      // the page rendered its own <main> after ours was set: keep only one
      ours.removeAttribute('role');
      ours.removeAttribute('data-wa-main');
      return;
    }
    if (ours || native || document.querySelector('[role="main"]')) return;
    var area = document.querySelector('.wa-is-page') || document.querySelector('section.wa-ut-main');
    if (area) {
      area.setAttribute('role', 'main');
      area.setAttribute('data-wa-main', '');
    }
  }

  function switchNames() {
    var list = document.querySelectorAll('button[role="switch"]:not([aria-label]):not([aria-labelledby])');
    for (var i = 0; i < list.length; i++) {
      var sw = list[i];
      if (text(sw)) continue;
      if (sw.id && document.querySelector('label[for="' + sw.id.replace(/"/g, '') + '"]')) continue;
      var row = sw.parentElement;
      var name = '';
      for (var depth = 0; row && depth < 3 && !name; depth++, row = row.parentElement) name = text(row);
      if (name) sw.setAttribute('aria-label', name.slice(0, 120));
    }
  }

  function smallFixes() {
    var dots = document.querySelectorAll('span[aria-label]:not([role])');
    // only empty marks (status dots); a span with text keeps its text semantics
    for (var i = 0; i < dots.length; i++) if (!text(dots[i]) && !dots[i].children.length) dots[i].setAttribute('role', 'img');
    // search button: its name comes from the visible "Buscar"; the shortcut stays in aria-keyshortcuts and title
    var cmd = document.querySelectorAll('.wa-tw-cmdbtn[aria-label]');
    for (var c = 0; c < cmd.length; c++) cmd[c].removeAttribute('aria-label');
    var kbd = document.querySelectorAll('.wa-tw-cmdbtn kbd:not([aria-hidden])');
    for (var k = 0; k < kbd.length; k++) kbd[k].setAttribute('aria-hidden', 'true');
    var labels = document.querySelectorAll('ul > li[role="none"], ol > li[role="none"]');
    for (var j = 0; j < labels.length; j++) labels[j].removeAttribute('role');
    // Agenda: the appointment name read aloud starts with what is written on it (time and contact), then the status
    var appts = document.querySelectorAll('.wag-appt[aria-label]');
    for (var a = 0; a < appts.length; a++) {
      var seen = text(appts[a]);
      var label = appts[a].getAttribute('aria-label') || '';
      if (seen && label.indexOf(seen) !== 0) {
        var status = label.split(', ').pop();
        appts[a].setAttribute('aria-label', seen + (status ? ', ' + status : ''));
      }
    }
    // instance sidebar: a navigation landmark (it was a plain box, so its links sat outside every landmark)
    var side = document.querySelector('[data-wa-sidebar]:not([role])');
    if (side && !side.closest('nav, aside, [role="navigation"]')) {
      side.setAttribute('role', 'navigation');
      side.setAttribute('aria-label', 'Menu da instância');
    }
    // conversation header inside the content area is a group, not a second page banner
    var heads = document.querySelectorAll('header.wa-conv-head:not([role])');
    for (var hd = 0; hd < heads.length; hd++) heads[hd].setAttribute('role', 'group');
    // view picker of Instâncias: the name read aloud includes the count shown on it
    var picks = document.querySelectorAll('.wa-ut-viewpick[aria-label]');
    for (var pk = 0; pk < picks.length; pk++) {
      var shown = text(picks[pk]);
      if (shown && picks[pk].getAttribute('aria-label') !== 'Visão: ' + shown) picks[pk].setAttribute('aria-label', 'Visão: ' + shown);
    }
    // resize handle of the chat columns points to a panel id that is not in the page
    var handles = document.querySelectorAll('[data-resize-handle][aria-controls]');
    for (var r = 0; r < handles.length; r++) {
      if (!document.getElementById(handles[r].getAttribute('aria-controls'))) handles[r].removeAttribute('aria-controls');
    }
  }

  function run() {
    try {
      mainLandmark();
      switchNames();
      smallFixes();
      pageTitle();
    } catch (e) {
      /* never break the panel because of a cosmetic fix */
    }
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(function () {
      queued = false;
      run();
    });
  }

  function start() {
    run();
    if ('MutationObserver' in window) {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
    } else {
      setInterval(run, 1000);
    }
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
