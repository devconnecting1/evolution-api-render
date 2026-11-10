/*
 * WhatsAI: fundo de pixels do plano Premium (canvas.px-bg). Escrito à mão, sem dependências.
 * Uma grade de pixels creme que cintila e é varrida por uma onda diagonal, como o "pensando" dos assistentes de IA.
 * Brilho máximo 0,22 (o texto do cartão mantém contraste AA). Roda a ~30 fps só enquanto o cartão está na tela e a aba
 * visível; com prefers-reduced-motion: reduce, desenha um quadro parado.
 */
(function () {
  var canvases = document.querySelectorAll('canvas.px-bg');
  if (!canvases.length || !window.requestAnimationFrame) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var STEP = 8, SIZE = 5, MAX = 0.22, FRAME = 1000 / 30;

  function setup(canvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var cols = 0, rows = 0, seeds = [], visible = false, raf = 0, last = 0, t0 = performance.now();

    function resize() {
      var r = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(r.width / STEP);
      rows = Math.ceil(r.height / STEP);
      seeds = new Array(cols * rows);
      for (var i = 0; i < seeds.length; i++) seeds[i] = Math.random();
      draw(reduce ? 2.4 : (performance.now() - t0) / 1000);
    }

    function draw(t) {
      var w = cols * STEP, h = rows * STEP;
      ctx.clearRect(0, 0, w, h);
      // onda diagonal que atravessa o cartão a cada ~7 s
      var front = ((t * 0.15) % 1.6) - 0.3;
      for (var y = 0; y < rows; y++) {
        for (var x = 0; x < cols; x++) {
          var s = seeds[y * cols + x];
          var tw = Math.sin(t * (0.6 + s * 1.4) + s * 40);
          tw = tw > 0 ? tw * tw * tw * tw : 0;
          var d = (x / cols) * 0.7 + (y / rows) * 0.3 - front;
          var wave = Math.exp(-(d * d) / 0.006);
          var a = (0.04 + 0.55 * tw * (s > 0.55 ? 1 : 0.25) + 0.6 * wave * (0.4 + s * 0.6)) * MAX;
          if (a < 0.012) continue;
          ctx.fillStyle = 'rgba(255,255,227,' + (a > MAX ? MAX : a).toFixed(3) + ')';
          ctx.fillRect(x * STEP, y * STEP, SIZE, SIZE);
        }
      }
    }

    function loop(now) {
      raf = 0;
      if (!visible || document.hidden) return;
      if (now - last >= FRAME) {
        last = now;
        draw((now - t0) / 1000);
      }
      raf = requestAnimationFrame(loop);
    }

    function start() {
      if (!reduce && visible && !document.hidden && !raf) raf = requestAnimationFrame(loop);
    }

    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);
    if (reduce) return;
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        start();
      }).observe(canvas);
    } else {
      visible = true;
      start();
    }
    document.addEventListener('visibilitychange', start);
  }

  for (var i = 0; i < canvases.length; i++) setup(canvases[i]);
})();
