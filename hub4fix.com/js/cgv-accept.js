/* Hub4Fix — scroll-to-accept modal for partner CGV (printer / modélisateur).
 *
 * The "Accept" button stays grey/disabled until the reader has BOTH:
 *   1. scrolled to the bottom of the contract (proof the whole text was shown),
 *   2. spent a minimum dwell time (so it can't be flung-to-bottom and accepted
 *      instantly) -- this is the "scroll slowly" requirement.
 * Only then does the button turn green and become clickable.
 *
 * Usage: add to a page
 *   <script src="js/cgv-accept.js"></script>
 * and any trigger element:
 *   <button class="act sign" data-cgv-accept="cgv-printer.html"
 *           data-cgv-title="CGV Printers">Lire et accepter</button>
 * On acceptance, fires a `cgv:accepted` event and stores the consent in
 * localStorage (demo). Replace that with a server call in production.
 */
(function () {
  var MIN_DWELL_MS = 12000;   // floor; real value scales with content length

  function buildModal() {
    var ov = document.createElement('div');
    ov.className = 'cgv-modal-ov';
    ov.innerHTML =
      '<div class="cgv-modal" role="dialog" aria-modal="true">' +
        '<div class="cgv-modal-head"><h2></h2>' +
          '<button class="cgv-modal-close" aria-label="Fermer">&times;</button></div>' +
        '<div class="cgv-progress"><div class="cgv-progress-fill"></div></div>' +
        '<div class="cgv-modal-body"></div>' +
        '<div class="cgv-modal-foot">' +
          '<div class="cgv-foot-left">' +
            '<div class="cgv-timer" aria-hidden="true">' +
              '<svg viewBox="0 0 44 44">' +
                '<circle class="cgv-timer-track" cx="22" cy="22" r="19"></circle>' +
                '<circle class="cgv-timer-prog" cx="22" cy="22" r="19"></circle>' +
              '</svg><span class="cgv-timer-num"></span>' +
            '</div>' +
            '<span class="cgv-hint"></span>' +
          '</div>' +
          '<button class="cgv-accept" disabled>Accepter</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    return ov;
  }

  var FAST_TRAVERSAL_MS = 1500; // top -> bottom faster than this = a "rush"
  var FLINGS_BEFORE_NUDGE = 3;  // rushes tolerated before the nudge fires

  var ov, modal, titleEl, bodyEl, fillEl, hintEl, acceptEl, closeEl, timerWrap, timerProg, timerNum;
  var TIMER_C = 2 * Math.PI * 19; // circonference de l'anneau (r=19)
  var state = { url: null, role: null, version: '1.0', reached: false, t0: 0, minMs: MIN_DWELL_MS, raf: 0,
                topT: 0, atTop: true, countedThisPass: false, flings: 0, nudged: false,
                reading: false, chunks: null, readIdx: 0, readTimer: 0, audio: null };

  function ensure() {
    if (ov) return;
    ov = buildModal();
    modal = ov.querySelector('.cgv-modal');
    titleEl = ov.querySelector('.cgv-modal-head h2');
    bodyEl = ov.querySelector('.cgv-modal-body');
    fillEl = ov.querySelector('.cgv-progress-fill');
    hintEl = ov.querySelector('.cgv-hint');
    acceptEl = ov.querySelector('.cgv-accept');
    timerWrap = ov.querySelector('.cgv-timer');
    timerProg = ov.querySelector('.cgv-timer-prog');
    timerNum = ov.querySelector('.cgv-timer-num');
    closeEl = ov.querySelector('.cgv-modal-close');
    closeEl.addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    bodyEl.addEventListener('scroll', onScroll, { passive: true });
    acceptEl.addEventListener('click', onAccept);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.classList.contains('open')) close(); });
  }

  // Anneau de progression : se remplit et passe du rouge au vert avec le temps.
  function updateTimer(p, secsLeft, ready) {
    if (!timerProg) return;
    var q = Math.max(0, Math.min(1, p));
    timerProg.style.strokeDasharray = TIMER_C;
    timerProg.style.strokeDashoffset = TIMER_C * (1 - q);
    if (ready) {
      timerWrap.classList.add('ready');
      timerProg.style.stroke = '#2D8B5E';
      timerNum.textContent = '✓';
      return;
    }
    timerWrap.classList.remove('ready');
    var r = Math.round(192 + (45 - 192) * q);
    var g = Math.round(57 + (139 - 57) * q);
    var b = Math.round(43 + (94 - 43) * q);
    timerProg.style.stroke = 'rgb(' + r + ',' + g + ',' + b + ')';
    timerNum.textContent = secsLeft > 0 ? secsLeft : '↓'; // ↓ = il reste à défiler
  }

  function tick() {
    var elapsed = Date.now() - state.t0;
    var waitLeft = Math.ceil((state.minMs - elapsed) / 1000);
    var ready = state.reached && elapsed >= state.minMs;
    updateTimer(elapsed / state.minMs, waitLeft, ready);
    if (ready) {
      acceptEl.disabled = false;
      acceptEl.classList.add('ready');
      hintEl.textContent = 'Vous pouvez accepter.';
      return; // stop the loop
    }
    // Don't fight the read-aloud messages while a voice-over owns the hint.
    if (!state.reading) {
      if (!state.reached) {
        hintEl.textContent = 'Faites défiler lentement jusqu’en bas pour activer le bouton.';
      } else {
        hintEl.textContent = 'Lecture terminée — encore ' + Math.max(0, waitLeft) + ' s avant d’accepter.';
      }
    }
    // setTimeout (not rAF): a 250ms countdown cadence is plenty, and it lets the
    // renderer go idle (continuous rAF would peg the CPU and block screenshots).
    state.raf = setTimeout(tick, 250);
  }

  function onScroll() {
    var now = Date.now();
    var y = bodyEl.scrollTop;
    var max = bodyEl.scrollHeight - bodyEl.clientHeight;
    // max > 4 : ne considere "bas atteint" QUE si le document est vraiment
    // defilable (evite un faux positif quand la mise en page n'est pas encore
    // calculee et que scrollHeight ~ clientHeight).
    var atBottom = max > 4 && y >= max - 8;
    var nearTop = y <= 100;

    // Rush detection by traversal TIME (robust to event coalescing): each time
    // the reader goes from the top to the bottom faster than a human could read,
    // count one "rush". After a few, nudge them.
    if (nearTop) {
      state.atTop = true; state.topT = now; state.countedThisPass = false;
    }
    if (atBottom && state.atTop && !state.countedThisPass) {
      var traversal = now - state.topT;
      if (traversal < FAST_TRAVERSAL_MS) {
        state.flings++;
        if (state.flings >= FLINGS_BEFORE_NUDGE && !state.nudged) showNudge();
      }
      state.countedThisPass = true; state.atTop = false;
    }

    var pct = max > 0 ? y / max : 1;
    fillEl.style.width = Math.min(100, Math.round(pct * 100)) + '%';
    if (atBottom) state.reached = true;
  }

  // Taquin nudge: after a few frantic flings, remind that these terms frame the
  // working relationship and deserve a real read.
  function showNudge() {
    state.nudged = true;
    var n = document.createElement('div');
    n.className = 'cgv-nudge';
    n.innerHTML =
      '<div class="cgv-nudge-card">' +
        '<div class="cgv-nudge-emoji">👀</div>' +
        '<h3>On vous voit défiler très vite…</h3>' +
        '<p>Ces conditions ne sont pas un formulaire anodin : elles <strong>cadrent ' +
        'notre future relation de travail</strong> — rémunération, droits, ' +
        'responsabilités, marquage des fichiers. Quelques minutes de lecture ' +
        'maintenant évitent bien des malentendus plus tard.</p>' +
        '<p class="cgv-nudge-sub">Prenez le temps : le bouton « Accepter » ' +
        's’activera une fois la lecture parcourue.</p>' +
        '<button class="cgv-nudge-read">🔊 Me lire les conditions</button>' +
        '<button class="cgv-nudge-ok">Je lis moi-même</button>' +
      '</div>';
    ov.appendChild(n);
    void n.offsetWidth;            // force reflow so the transition plays
    n.classList.add('show');
    function dismiss() {
      n.classList.remove('show');
      setTimeout(function () { n.remove(); }, 250);
      state.flings = 0;            // reset the counter, give them a fresh start
    }
    n.querySelector('.cgv-nudge-ok').addEventListener('click', function () {
      dismiss();
      bodyEl.scrollTop = 0;        // back to the top to actually read
      state.reached = false;
      fillEl.style.width = '0%';
    });
    n.querySelector('.cgv-nudge-read').addEventListener('click', function () {
      dismiss();
      startReading();              // karaoke read-aloud from the top
    });
  }

  // ---- Read-aloud (karaoke) : TTS + line highlight + auto-scroll ----
  // Turns the nudge into a service: a French voice reads the contract while the
  // current line is highlighted and scrolled into view, paced to reading speed.
  // The visual is timer-driven (with speech onend as the primary advance), so it
  // still works even when no TTS voice/audio is available.
  function pickFrenchVoice() {
    if (!('speechSynthesis' in window)) return null;
    var vs = window.speechSynthesis.getVoices() || [];
    return vs.filter(function (v) { return /^fr/i.test(v.lang); })[0] || null;
  }

  function getChunks() {
    return [].slice.call(bodyEl.querySelectorAll('.doc h1, .doc h2, .doc h3, .doc p, .doc li'))
             .filter(function (el) { return (el.textContent || '').trim().length > 1; });
  }

  function startReading() {
    if (state.reading) return;
    state.reading = true;
    bodyEl.scrollTop = 0;
    state.chunks = getChunks();
    state.readIdx = 0;
    hintEl.textContent = 'Préparation de la lecture…';
    // Prefer a pre-generated premium voice (ElevenLabs MP3 + per-chunk timings).
    // Convention: audio/<doc>.mp3 + audio/<doc>.align.json. Fall back to the
    // browser Web Speech voice if they are not (yet) published.
    var base = 'audio/' + state.url.replace(/\.html?$/i, '');
    fetch(base + '.align.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (align) { playAudioKaraoke(base + '.mp3', align); })
      .catch(function () { startSpeechReading(); });
  }

  // Premium path: play the ElevenLabs MP3, sync highlight/scroll to currentTime.
  function playAudioKaraoke(mp3Url, align) {
    var starts = (align && align.chunks) ? align.chunks.map(function (c) { return c.start; }) : [];
    if (!starts.length || starts.length !== state.chunks.length) {
      // alignment doesn't match the rendered text -> safer to use speech
      return startSpeechReading();
    }
    hintEl.textContent = '🔊 Lecture vocale (voix premium)…';
    var audio = new Audio(mp3Url);
    state.audio = audio;
    var last = -1;
    audio.addEventListener('timeupdate', function () {
      if (!state.reading) return;
      var t = audio.currentTime, i = 0;
      while (i + 1 < starts.length && starts[i + 1] <= t) i++;
      if (i !== last) {
        last = i;
        state.chunks.forEach(function (c) { c.classList.remove('cgv-reading'); });
        var el = state.chunks[i];
        el.classList.add('cgv-reading');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        fillEl.style.width = Math.round((i + 1) / state.chunks.length * 100) + '%';
      }
    });
    audio.addEventListener('ended', finishReading);
    audio.play().catch(function () { startSpeechReading(); }); // autoplay blocked -> speech
  }

  function startSpeechReading() {
    hintEl.textContent = 'Lecture vocale en cours…';
    readNext();
  }

  function readNext() {
    if (!state.reading) return;
    if (state.readIdx >= state.chunks.length) return finishReading();
    var el = state.chunks[state.readIdx];
    state.chunks.forEach(function (c) { c.classList.remove('cgv-reading'); });
    el.classList.add('cgv-reading');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });

    var text = (el.textContent || '').trim();
    var words = text.split(/\s+/).length;
    var estMs = Math.max(1200, Math.round(words * 360)); // ~165 wpm
    var advanced = false;
    function advance() {
      if (advanced || !state.reading) return;
      advanced = true;
      clearTimeout(state.readTimer);
      state.readIdx++;
      readNext();
    }

    if ('speechSynthesis' in window) {
      try {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'fr-FR'; u.rate = 0.95;
        var v = pickFrenchVoice(); if (v) u.voice = v;
        u.onend = advance;
        window.speechSynthesis.speak(u);
      } catch (e) { /* fall through to timer */ }
    }
    // watchdog/fallback so the karaoke advances even if onend never fires
    state.readTimer = setTimeout(advance, estMs * ('speechSynthesis' in window ? 1.6 : 1));
  }

  function finishReading() {
    stopReading();
    state.reached = true;          // whole contract was read -> gate satisfied
    fillEl.style.width = '100%';
    hintEl.textContent = 'Lecture terminée.';
  }

  function stopReading() {
    state.reading = false;
    clearTimeout(state.readTimer);
    if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    if (state.audio) { try { state.audio.pause(); } catch (e) {} state.audio = null; }
    if (state.chunks) state.chunks.forEach(function (c) { c.classList.remove('cgv-reading'); });
  }

  function open(url, title, role) {
    ensure();
    stopReading();                 // clear any leftover read-aloud
    state.url = url; state.role = role || url;
    state.reached = false; state.t0 = Date.now();
    state.topT = Date.now(); state.atTop = true; state.countedThisPass = false;
    state.flings = 0; state.nudged = false;
    titleEl.innerHTML = title || 'Conditions';
    bodyEl.innerHTML = '<p class="cgv-hint" style="padding:2rem 0">Chargement…</p>';
    fillEl.style.width = '0%';
    acceptEl.disabled = true; acceptEl.classList.remove('ready', 'done');
    acceptEl.textContent = 'Accepter';
    ov.classList.add('open');
    document.body.style.overflow = 'hidden';

    fetch(url).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var main = doc.querySelector('main.doc') || doc.querySelector('main');
      bodyEl.innerHTML = '';
      var wrap = document.createElement('div');
      wrap.className = 'doc';
      wrap.innerHTML = main ? main.innerHTML : html;
      bodyEl.appendChild(wrap);
      // dwell scales with length, clamped to a sane window
      var words = (wrap.textContent || '').trim().split(/\s+/).length;
      state.minMs = Math.min(25000, Math.max(MIN_DWELL_MS, Math.round(words * 35)));
      state.t0 = Date.now();
      bodyEl.scrollTop = 0;
      fillEl.style.width = '0%';
      // Attendre que la mise en page soit calculee avant de juger la hauteur :
      // un document court (non defilable) est accepte d'office, un long exige
      // d'etre defile jusqu'en bas.
      requestAnimationFrame(function () {
        var max = bodyEl.scrollHeight - bodyEl.clientHeight;
        if (max <= 4) { state.reached = true; fillEl.style.width = '100%'; }
      });
      clearTimeout(state.raf);
      tick();
    }).catch(function () {
      bodyEl.innerHTML = '<p style="padding:2rem 0;color:#C0392B">Impossible de charger le document. ' +
        'Ouvrez-le directement : <a href="' + url + '">' + url + '</a></p>';
    });
  }

  function close() {
    if (!ov) return;
    stopReading();                 // stop any read-aloud in progress
    ov.classList.remove('open');
    document.body.style.overflow = '';
    clearTimeout(state.raf);
  }

  // Petits cotillons a l'acceptation : auto-contenu, sans dependance.
  function ensureConfettiCss() {
    if (document.getElementById('h4f-conf-css')) return;
    var s = document.createElement('style');
    s.id = 'h4f-conf-css';
    s.textContent = '@keyframes h4fConfFall{to{transform:translate(var(--xend),105vh) rotate(720deg);opacity:.15}}';
    document.head.appendChild(s);
  }
  function confettiBurst() {
    ensureConfettiCss();
    var colors = ['#C0392B', '#2D8B5E', '#B8963E', '#2a00fe', '#fe0000', '#FDFAF5'];
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2000;overflow:hidden';
    document.body.appendChild(box);
    for (var i = 0; i < 150; i++) {
      var p = document.createElement('div');
      var w = 6 + Math.random() * 8;
      p.style.cssText = 'position:absolute;top:-24px;left:' + (Math.random() * 100) + '%;' +
        'width:' + w + 'px;height:' + (w * 0.5 + 4) + 'px;background:' + colors[i % colors.length] + ';' +
        'opacity:.95;border-radius:1px;will-change:transform;' +
        '--xend:' + ((Math.random() * 2 - 1) * 140) + 'px;' +
        'animation:h4fConfFall ' + (2.2 + Math.random() * 1.8) + 's ' + (Math.random() * 0.35) + 's ease-in forwards';
      box.appendChild(p);
    }
    setTimeout(function () { box.remove(); }, 4600);
  }

  // Célébration : cotillons plein écran + carte de bienvenue festive.
  function celebrate(role) {
    var msg = role === 'printer' ? 'Bienvenue dans le réseau de printers !'
            : role === 'modelisateur' ? 'Bienvenue parmi les modélisateurs !'
            : 'Bienvenue chez Hub⁴Fix !';

    // carte de bienvenue
    var w = document.createElement('div');
    w.className = 'cgv-welcome';
    w.innerHTML = '<div class="cgv-welcome-card">' +
        '<div class="cgv-welcome-emoji">🎉</div>' +
        '<h3>' + msg + '</h3>' +
        '<p>Conditions acceptées — ravis de vous compter parmi nous.</p>' +
      '</div>';
    document.body.appendChild(w);
    void w.offsetWidth;
    w.classList.add('show');
    setTimeout(function () { w.classList.remove('show'); setTimeout(function () { w.remove(); }, 400); }, 2800);

    // cotillons plein écran (réutilise confettiBurst, respecte reduced-motion)
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    confettiBurst();
  }

  function onAccept() {
    if (acceptEl.disabled) return;
    var consent = { accepted: true, role: state.role, doc: state.url,
                    version: state.version, at: new Date().toISOString() };
    try { localStorage.setItem('h4f_cgv_' + state.role, JSON.stringify(consent)); } catch (e) {}
    window.H4FConsent[state.role] = consent;   // available to signup forms
    acceptEl.classList.add('done');
    acceptEl.textContent = '✓ Accepté';
    hintEl.textContent = 'Acceptation enregistrée.';
    document.dispatchEvent(new CustomEvent('cgv:accepted', { detail: consent }));
    celebrate(state.role);
    setTimeout(close, 1200);
  }

  // auto-wire triggers
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-cgv-accept]');
    if (!t) return;
    e.preventDefault();
    state.version = t.getAttribute('data-cgv-version') || '1.0';
    open(t.getAttribute('data-cgv-accept'),
         t.getAttribute('data-cgv-title') || t.textContent.trim(),
         t.getAttribute('data-cgv-role') || t.getAttribute('data-cgv-accept'));
  });

  // expose for programmatic use
  window.H4FConsent = window.H4FConsent || {};
  window.H4FCgv = { open: open, close: close };
})();
