/* WhatsAI Manager: correcoes funcionais da auditoria de 12/11/2026 (manager/patches/qa-polish.py). */
(function () {
  'use strict';

  function closest(element, selector) {
    return element && element.closest ? element.closest(selector) : null;
  }

  // Lead board: the card body opens the lead page; the name link and the status menu keep their own behavior.
  function leadHref(card) {
    var link = card.querySelector('a.wl-card-name[href]');
    return link ? link.getAttribute('href') : '';
  }

  function openLead(card) {
    var href = leadHref(card);
    if (href) window.location.assign(href);
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    var card = closest(event.target, 'article.wl-card');
    if (!card) return;
    if (closest(event.target, 'a, button, input, select, textarea, [role="button"], [role="menuitem"]')) return;
    openLead(card);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var card = closest(event.target, 'article.wl-card');
    if (!card || event.target !== card) return;
    event.preventDefault();
    openLead(card);
  });

  // Mobile drawer: keep the keyboard focus inside while it is open and give it back when it closes.
  function sidebar() {
    return document.getElementById('wa-sidebar');
  }

  function drawerOpen(element) {
    return !!element && element.getAttribute('data-wa-open') === 'true';
  }

  function focusables(element) {
    return Array.prototype.slice
      .call(element.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(function (item) {
        return item.offsetParent !== null;
      });
  }

  document.addEventListener('click', function (event) {
    var element = sidebar();
    if (!element) return;
    if (closest(event.target, '.wa-menu-toggle')) {
      window.setTimeout(function () {
        if (!drawerOpen(element)) return;
        element.setAttribute('aria-modal', 'true');
        var items = focusables(element);
        if (items[0]) items[0].focus();
      }, 60);
      return;
    }
    if (!drawerOpen(element) || !element.contains(event.target)) {
      element.removeAttribute('aria-modal');
    }
  });

  document.addEventListener('keydown', function (event) {
    var element = sidebar();
    if (!element) return;
    if (event.key === 'Escape') {
      element.removeAttribute('aria-modal');
      return;
    }
    if (event.key !== 'Tab' || !drawerOpen(element)) return;
    var items = focusables(element);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
})();
