(function () {
  var cvs = document.createElement('canvas');
  cvs.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  document.body.insertBefore(cvs, document.body.firstChild);
  var ctx = cvs.getContext('2d');

  var GRID   = 28;
  var BASE_R = 1.5;
  var MAX_R  = 5.5;

  var vw, vh, dpr, sR, sY, raf = 0;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    vw  = window.innerWidth;
    vh  = window.innerHeight;
    cvs.width  = Math.round(vw * dpr);
    cvs.height = Math.round(vh * dpr);
    sR = Math.min(vw, vh) * 0.22;
    document.documentElement.style.setProperty('--sphere-r', sR.toFixed(0) + 'px');
    update();
  }

  function update() {
    var max   = Math.max(1, document.documentElement.scrollHeight - vh);
    var ratio = Math.min(1, Math.max(0, window.scrollY / max));
    sY = -sR + ratio * (vh + sR * 2);
    document.documentElement.style.setProperty('--sphere-y', sY.toFixed(1) + 'px');
    if (!raf) raf = requestAnimationFrame(draw);
  }

  function draw() {
    raf = 0;
    var w = vw, h = vh;
    var cx = w * 0.5, cy = sY;
    var R = sR, R2 = R * R;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    var ox = ((cx % GRID) + GRID) % GRID;
    var oy = (((h * 0.5) % GRID) + GRID) % GRID;

    for (var gx = ox - GRID; gx < w + GRID; gx += GRID) {
      for (var gy = oy - GRID; gy < h + GRID; gy += GRID) {
        var dx = gx - cx, dy = gy - cy;
        var d2 = dx * dx + dy * dy;
        var r = BASE_R, alpha = 0.22, px = gx, py = gy;

        if (d2 < R2) {
          var d  = Math.sqrt(d2);
          var t  = 1 - d / R;       // 0 en peripherie, 1 au centre
          var t2 = t * t;            // chute quadratique
          r     = BASE_R + (MAX_R - BASE_R) * t2;
          alpha = 0.22 + 0.2 * t2;
          // Deplacement radial (tissu etire par la sphere)
          if (d > 2) {
            var push = t * (1 - t) * 30;
            px = gx + (dx / d) * push;
            py = gy + (dy / d) * push;
          }
        }

        ctx.beginPath();
        ctx.arc(px, py, r, 0, 6.2832);
        ctx.fillStyle = 'rgba(168,159,145,' + alpha.toFixed(3) + ')';
        ctx.fill();
      }
    }
    ctx.restore();
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('scroll', update, { passive: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resize);
  } else {
    resize();
  }
}());
