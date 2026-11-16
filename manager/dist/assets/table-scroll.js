/*
 * WhatsAI: sinaliza tabelas que rolam na horizontal.
 *
 * Em telas estreitas, as tabelas da landing e do /docs passam da largura da coluna. Sem uma pista, a ultima
 * coluna parece simplesmente cortada. Este script adiciona uma dica antes da tabela, marca o wrapper como
 * rolavel e aplica uma mascara suave na borda direita enquanto houver conteudo para ver. Quando a tabela cabe,
 * nada aparece. Sem dependencia, sem timer e sem chamada de rede.
 *
 * O CSS correspondente fica em docs.css (.table-wrap) e landing-cursor.css (.wa-table-wrap).
 */
(function () {
  'use strict';

  var SELECTOR = '.table-wrap, .wa-table-wrap';
  var HINT = 'Deslize para ver a tabela completa';

  function setup() {
    var wraps = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < wraps.length; i++) {
      var wrap = wraps[i];
      if (wrap.getAttribute('data-table-scroll') === '1') continue;
      wrap.setAttribute('data-table-scroll', '1');

      var hint = document.createElement('p');
      hint.className = 'table-scroll-hint';
      hint.textContent = HINT;
      hint.hidden = true;
      wrap.parentNode.insertBefore(hint, wrap);

      if (!wrap.hasAttribute('role')) wrap.setAttribute('role', 'region');
      if (!wrap.hasAttribute('aria-label')) wrap.setAttribute('aria-label', 'Tabela com rolagem horizontal');

      (function (wrapper, note) {
        function update() {
          var max = wrapper.scrollWidth - wrapper.clientWidth;
          var scrollable = max > 2;
          wrapper.classList.toggle('is-scrollable', scrollable);
          wrapper.classList.toggle('is-at-end', scrollable && wrapper.scrollLeft >= max - 2);
          note.hidden = !scrollable;
          if (scrollable) wrapper.setAttribute('tabindex', '0');
        }

        update();
        wrapper.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update, { passive: true });
        var details = wrapper.closest('details');
        if (details) details.addEventListener('toggle', update);
        if (window.ResizeObserver) {
          var observer = new ResizeObserver(update);
          observer.observe(wrapper);
          var table = wrapper.querySelector('table');
          if (table) observer.observe(table);
        }
      })(wrap, hint);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
