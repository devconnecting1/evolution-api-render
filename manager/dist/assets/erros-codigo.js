/*
 * WhatsAI Manager: codigo e hora nos estados de erro (manager/patches/painel-pendentes.py).
 * Plain script, loaded before the bundle. Two jobs:
 *
 *   1. records the status and the local time of the last failed request (fetch and XHR, which axios uses);
 *   2. after each render, adds a discreet line to the existing error states:
 *        Codigo do erro: 503 - 12/11 21:04 - copiar para o suporte
 *      The line carries no stack trace, URL or internal detail: only the HTTP status (or "sem conexao" when the
 *      request did not reach the server) and the time the client can send to support.
 *
 * The copy button writes "Codigo do erro: 503 - 12/11 21:04" to the clipboard (with a fallback for browsers
 * without navigator.clipboard). Nothing here calls the API and nothing runs on a timer that queries the database:
 * the observer only reads the DOM, debounced to one pass per render.
 */
(function () {
  'use strict';

  if (window.WaErrCode) return;

  var last = { status: 0, at: 0 };
  var doc = document;

  function record(status) {
    last = { status: Number(status) || 0, at: Date.now() };
  }

  window.WaErrCode = {
    last: function () {
      return { status: last.status, at: last.at };
    },
  };

  /* ------------------------------------------------------------------ network hooks (fetch + XHR) */
  var originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function () {
      var promise = originalFetch.apply(this, arguments);
      if (promise && typeof promise.then === 'function') {
        promise.then(
          function (response) {
            try {
              if (response && response.status >= 400) record(response.status);
            } catch (e) {}
          },
          function () {
            record(0);
          }
        );
      }
      return promise;
    };
  }

  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    var originalOpen = window.XMLHttpRequest.prototype.open;
    var originalSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function () {
      try {
        this.__waErrUrl = String(arguments[1] || '');
      } catch (e) {}
      return originalOpen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      try {
        xhr.addEventListener('load', function () {
          try {
            if (xhr.status >= 400) record(xhr.status);
          } catch (e) {}
        });
        xhr.addEventListener('error', function () {
          record(0);
        });
        xhr.addEventListener('timeout', function () {
          record(0);
        });
      } catch (e) {}
      return originalSend.apply(this, arguments);
    };
  }

  /* ------------------------------------------------------------------------------------ error blocks */
  var BLOCKS = '.wa-chat-empty,.wa-ut-empty,.wa-tw-empty,.wa-fl-error,.wp-callout,.wag-callout,.wu-callout,.wa-ai-hours-error,.wa-fin-error';
  var TITLE = /^(não foi possível (carregar|ler|falar)|não deu para carregar|não carregou agora|falha ao|erro ao)/i;

  function text(element) {
    return (element && element.textContent ? element.textContent : '').replace(/\s+/g, ' ').trim();
  }

  function each(selector, callback, scope) {
    Array.prototype.forEach.call((scope || doc).querySelectorAll(selector), callback);
  }

  function hasRetry(block) {
    var found = false;
    each('button', function (button) {
      if (!found && /^tentar de novo$/i.test(text(button))) found = true;
    }, block);
    return found;
  }

  function isError(block) {
    if (!block || block.querySelector('.wa-errcode')) return false;
    if (TITLE.test(text(block))) return true;
    var alert = block.getAttribute('role') === 'alert';
    return hasRetry(block) && (alert || block.getAttribute('data-tone') === 'bad');
  }

  function pad(value) {
    return String(value).length < 2 ? '0' + value : String(value);
  }

  function stamp(ts) {
    var date = new Date(ts || Date.now());
    return pad(date.getDate()) + '/' + pad(date.getMonth() + 1) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function copyText(value, done) {
    function fallback() {
      var area = doc.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      doc.body.appendChild(area);
      try {
        area.select();
        area.setSelectionRange(0, value.length);
        doc.execCommand('copy');
        done();
      } catch (e) {
      } finally {
        doc.body.removeChild(area);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done, fallback);
    } else {
      fallback();
    }
  }

  function codeLine() {
    var info = last;
    var status = info.status > 0 ? String(info.status) : 'sem conexão';
    var at = info.at > 0 ? info.at : Date.now();
    var label = 'Código do erro: ' + status + ' · ' + stamp(at);

    var line = doc.createElement('p');
    line.className = 'wa-errcode';

    var caption = doc.createElement('span');
    caption.textContent = 'Código do erro: ';
    var code = doc.createElement('span');
    code.className = 'wa-errcode-code';
    code.textContent = status;
    var sep1 = doc.createElement('span');
    sep1.className = 'wa-errcode-sep';
    sep1.setAttribute('aria-hidden', 'true');
    sep1.textContent = '·';
    var when = doc.createElement('span');
    when.textContent = stamp(at);
    var sep2 = doc.createElement('span');
    sep2.className = 'wa-errcode-sep';
    sep2.setAttribute('aria-hidden', 'true');
    sep2.textContent = '·';

    var copy = doc.createElement('button');
    copy.type = 'button';
    copy.className = 'wa-errcode-copy';
    copy.textContent = 'copiar para o suporte';
    copy.setAttribute('aria-label', 'Copiar o código do erro (' + status + ') e o horário para o suporte');
    copy.addEventListener('click', function () {
      copyText(label, function () {
        copy.textContent = 'copiado';
        copy.setAttribute('data-copied', 'true');
        window.setTimeout(function () {
          copy.textContent = 'copiar para o suporte';
          copy.removeAttribute('data-copied');
        }, 2000);
      });
    });

    line.appendChild(caption);
    line.appendChild(code);
    line.appendChild(sep1);
    line.appendChild(when);
    line.appendChild(sep2);
    line.appendChild(copy);
    return line;
  }

  function addLine(block) {
    var line = codeLine();
    var paragraphs = block.querySelectorAll('p');
    var anchor = paragraphs.length ? paragraphs[paragraphs.length - 1] : null;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(line, anchor.nextSibling);
    else block.appendChild(line);
  }

  function apply() {
    each(BLOCKS, function (block) {
      if (isError(block)) addLine(block);
    });
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(function () {
      scheduled = false;
      apply();
    }, 80);
  }

  function start() {
    schedule();
    if (typeof MutationObserver !== 'undefined' && doc.body) {
      new MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true });
    }
    window.addEventListener('popstate', schedule);
    window.addEventListener('hashchange', schedule);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})();
