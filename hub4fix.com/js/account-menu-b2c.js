/* ============================================================
 * Hub4Fix — Menu compte (dropdown) du tronc B2C.
 *
 * Clic « Mon compte » -> dropdown :
 *   - déconnecté : connexion rapide (e-mail + mot de passe) + bascule inscription.
 *   - connecté   : infos, solde de tokens, « Ma bibliothèque », liens, déconnexion.
 *
 * Auth RÉELLE via le worker h4f-api (D1) :
 *   POST /auth/signup · POST /auth/login · GET /auth/me · POST /auth/logout
 * Session = cookie httpOnly signé (posé par le worker), jamais de mot de passe stocké côté client.
 *
 * AUTH_ORIGIN doit pointer sur le worker (custom domain api.hub4fix.com pour que
 * le cookie soit 1re partie). En préview locale (localhost), l'API distante n'est
 * pas jointe -> repli démo localStorage pour garder le menu explorable.
 * ============================================================ */
(function () {
  'use strict';

  var AUTH_ORIGIN = window.H4F_AUTH_ORIGIN || 'https://h4f-api.duclosjulien.workers.dev';
  var IS_LOCAL = ['localhost', '127.0.0.1'].indexOf(location.hostname) !== -1;
  var DEMO_KEY = 'h4f_session_demo';
  var TOKEN_KEY = 'h4f_token'; // clé de session (en-tête Authorization), pas de cookie cross-origin

  var profile = null;     // { email, prenom, tokens, library:[...] } ou null
  var authMode = 'login'; // 'login' | 'signup' | 'forgot-email' | 'forgot-code'
  var view = 'auth';      // 'auth' | 'account' | 'library' | 'profile'
  var forgotEmail = '';   // e-mail saisi à l'étape "mot de passe oublié"

  // ---- API ----
  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    var tok = localStorage.getItem(TOKEN_KEY);
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    return fetch(AUTH_ORIGIN + path, Object.assign({ method: 'GET' }, opts, { headers: headers }));
  }
  // Repli démo local : simule une session tant que l'API distante n'est pas jointe.
  function demoGet() { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch (e) { return null; } }
  function demoSet(p) { localStorage.setItem(DEMO_KEY, JSON.stringify(p)); }
  function demoClear() { localStorage.removeItem(DEMO_KEY); }
  function demoProfile(email) {
    return { email: email, prenom: email.split('@')[0], tokens: 5, library: [], _demo: true };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ico(paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }

  // ---- Roue "100% gagnant" (récompense d'inscription) ----
  var WHEEL_SEGMENTS = [10, 5, 3, 2, 1];                  // sens horaire depuis le haut
  var WHEEL_WEIGHTS = { 10: 5, 5: 55, 3: 20, 2: 12, 1: 8 }; // démo LOCALE ; en prod le serveur fait foi
  var WHEEL_COLORS = { 10: '#B8963E', 5: '#C8102E', 3: '#2D8B5E', 2: '#3B3632', 1: '#A89F91' };

  function wheelDemoDraw() {
    var total = 0, k; for (k in WHEEL_WEIGHTS) total += WHEEL_WEIGHTS[k];
    var r = Math.random() * total;
    for (var i = 0; i < WHEEL_SEGMENTS.length; i++) { var s = WHEEL_SEGMENTS[i]; r -= WHEEL_WEIGHTS[s]; if (r < 0) return s; }
    return 5;
  }
  function wheelPoint(cx, cy, r, deg) { var t = deg * Math.PI / 180; return [cx + r * Math.sin(t), cy - r * Math.cos(t)]; }
  function buildWheelSVG() {
    var cx = 150, cy = 150, r = 140, seg = 72, out = '';
    for (var i = 0; i < 5; i++) {
      var s = WHEEL_SEGMENTS[i];
      var p0 = wheelPoint(cx, cy, r, i * seg), p1 = wheelPoint(cx, cy, r, (i + 1) * seg);
      out += '<path d="M' + cx + ' ' + cy + ' L' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) +
        ' A' + r + ' ' + r + ' 0 0 1 ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) + ' Z" fill="' + WHEEL_COLORS[s] + '" stroke="#fff" stroke-width="2"/>';
      var lp = wheelPoint(cx, cy, r * 0.64, i * seg + seg / 2);
      out += '<text x="' + lp[0].toFixed(1) + '" y="' + lp[1].toFixed(1) + '" class="wheel-lbl" text-anchor="middle" dominant-baseline="central">' + s + '</text>';
    }
    return '<svg viewBox="0 0 300 300" class="wheel-svg"><g class="wheel-rot">' + out +
      '<circle class="wheel-hub" cx="150" cy="150" r="22"/></g></svg>';
  }
  // opts.target = gain imposé par le serveur (number) ou undefined -> tirage démo local
  // opts.onDone(amount) appelé à la fermeture
  function showWheel(opts) {
    opts = opts || {};
    var overlay = document.createElement('div');
    overlay.className = 'wheel-overlay';
    overlay.innerHTML =
      '<div class="wheel-card">' +
        '<div class="wheel-eyebrow">Ta roue de bienvenue</div>' +
        '<h3 class="wheel-title">Tu gagnes des tokens, à coup sûr</h3>' +
        '<div class="wheel-stage"><div class="wheel-pointer"></div>' + buildWheelSVG() + '</div>' +
        '<button class="btn btn-primary wheel-spin" type="button">Tourner la roue</button>' +
        '<div class="wheel-result" hidden></div>' +
        '<p class="wheel-legal">Chaque nouvel inscrit gagne des tokens, sans obligation d\'achat. ' +
          'Les tokens servent à générer tes fichiers (slices) — non convertibles en argent.</p>' +
      '</div>';
    document.body.appendChild(overlay);
    var rot = overlay.querySelector('.wheel-rot');
    var btn = overlay.querySelector('.wheel-spin');
    var resultBox = overlay.querySelector('.wheel-result');
    var phase = 'ready', amount = 5;

    btn.addEventListener('click', function () {
      if (phase === 'spinning') return;
      if (phase === 'done') { overlay.remove(); if (opts.onDone) opts.onDone(amount); return; }
      phase = 'spinning';
      amount = (typeof opts.target === 'number') ? opts.target : wheelDemoDraw();
      var i = WHEEL_SEGMENTS.indexOf(amount); if (i < 0) { i = 1; amount = 5; }
      var jitter = Math.random() * 44 - 22;                 // dans le segment (72° de large)
      var R = 360 * 5 - (i * 72 + 36) + jitter;             // 5 tours + segment cible sous le pointeur
      btn.disabled = true;
      rot.style.transition = 'transform 4s cubic-bezier(.15,.85,.25,1)';
      rot.style.transform = 'rotate(' + R + 'deg)';
      var settled = false;
      function settle() {
        if (settled) return; settled = true;
        resultBox.innerHTML = '<span class="wheel-amount">⬡ ' + amount + '</span> ' + (amount > 1 ? 'tokens crédités' : 'token crédité') + ' !';
        resultBox.hidden = false;
        btn.textContent = 'Continuer'; btn.disabled = false; phase = 'done';
      }
      rot.addEventListener('transitionend', settle, { once: true });
      setTimeout(settle, 4400); // filet de sécurité si transitionend manque
    });
  }

  // ---- Vues ----
  function viewAuth(mode) {
    var isSignup = mode === 'signup';
    return '' +
      '<div class="acct-head">' +
        '<div class="title">' + (isSignup ? 'Créer un compte' : 'Bienvenue') + '</div>' +
        '<div class="sub">' + (isSignup
          ? '30 secondes, et tes tokens t\'attendent.'
          : 'Connecte-toi pour retrouver tes pièces et tes tokens.') + '</div>' +
      '</div>' +
      '<div class="acct-body">' +
        '<form class="acct-form" data-mode="' + (isSignup ? 'signup' : 'login') + '">' +
          '<div class="acct-field"><label>E-mail</label>' +
            '<input type="email" name="email" required autocomplete="email" placeholder="ton@email.fr"></div>' +
          '<div class="acct-field"><label>Mot de passe</label>' +
            '<input type="password" name="password" required minlength="8" ' +
            'autocomplete="' + (isSignup ? 'new-password' : 'current-password') + '" placeholder="••••••••"></div>' +
          (isSignup ? '' : '<span class="acct-forgot" data-action="forgot">Mot de passe oublié ?</span>') +
          '<button type="submit" class="btn btn-primary">' + (isSignup ? 'Créer mon compte' : 'Se connecter') + '</button>' +
          '<div class="acct-msg" role="alert" hidden></div>' +
        '</form>' +
        '<div class="acct-alt">' + (isSignup
          ? 'Déjà inscrit ? <a data-action="to-login">Se connecter</a>'
          : 'Pas encore de compte ? <a data-action="to-signup">Créer un compte</a>') + '</div>' +
      '</div>';
  }

  function viewAccount(p) {
    var prenom = p.prenom || (p.email ? p.email.split('@')[0] : 'là');
    var n = (p.library || []).length;
    return '' +
      '<div class="acct-head">' +
        '<div class="title">Bonjour ' + esc(prenom) + '</div>' +
        '<div class="sub">' + esc(p.email || '') + '</div>' +
      '</div>' +
      '<div class="acct-tokens"><span class="lbl">Tes tokens H4F</span>' +
        '<span class="val">⬡ ' + (parseInt(p.tokens, 10) || 0) + '</span></div>' +
      '<div class="acct-links">' +
        '<a class="acct-link" href="produits.html">' + ico('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>') + 'Trouver une pièce</a>' +
        '<a class="acct-link" data-action="profile">' + ico('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0112 0v1"/>') + 'Mon profil</a>' +
        '<a class="acct-link" data-action="library">' + ico('<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>') + 'Ma bibliothèque<span class="acct-count">' + n + '</span></a>' +
        '<a class="acct-link" href="partenaires.html">' + ico('<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>') + 'Devenir partenaire</a>' +
        '<a class="acct-link danger" data-action="logout">' + ico('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>') + 'Déconnexion</a>' +
      '</div>';
  }

  function viewLibrary(p) {
    var items = p.library || [];
    var body;
    if (!items.length) {
      body = '<div class="acct-empty">Ta bibliothèque est vide.<br>Tes fichiers achetés apparaîtront ici.</div>';
    } else {
      body = '<div class="acct-lib">' + items.map(function (it) {
        return '<div class="acct-lib-item">' +
          '<span class="acct-lib-name">' + esc(it.product_name || it.product_id) + '</span>' +
          '<span class="acct-lib-flux">' + esc(it.flux || '') + '</span></div>';
      }).join('') + '</div>';
    }
    return '' +
      '<div class="acct-head acct-head-row">' +
        '<button class="acct-back" data-action="to-account" aria-label="Retour">' + ico('<path d="M15 18l-6-6 6-6"/>') + '</button>' +
        '<div><div class="title">Ma bibliothèque</div>' +
        '<div class="sub">' + items.length + ' fichier' + (items.length > 1 ? 's' : '') + '</div></div>' +
      '</div>' + body;
  }

  function viewForgotEmail() {
    return '' +
      '<div class="acct-head"><div class="title">Mot de passe oublié</div>' +
        '<div class="sub">On t\'envoie un code par e-mail.</div></div>' +
      '<div class="acct-body">' +
        '<form class="acct-form" data-mode="forgot-request">' +
          '<div class="acct-field"><label>E-mail</label>' +
            '<input type="email" name="email" required autocomplete="email" placeholder="ton@email.fr"></div>' +
          '<button type="submit" class="btn btn-primary">Recevoir un code</button>' +
          '<div class="acct-msg" role="alert" hidden></div>' +
        '</form>' +
        '<div class="acct-alt"><a data-action="to-login">Retour</a></div>' +
      '</div>';
  }
  function viewForgotCode(email) {
    return '' +
      '<div class="acct-head"><div class="title">Nouveau mot de passe</div>' +
        '<div class="sub">Code envoyé à ' + esc(email) + '</div></div>' +
      '<div class="acct-body">' +
        '<form class="acct-form" data-mode="forgot-confirm">' +
          '<div class="acct-field"><label>Code reçu (6 chiffres)</label>' +
            '<input type="text" name="code" required inputmode="numeric" autocomplete="one-time-code" placeholder="123456"></div>' +
          '<div class="acct-field"><label>Nouveau mot de passe</label>' +
            '<input type="password" name="password" required minlength="8" autocomplete="new-password" placeholder="••••••••"></div>' +
          '<button type="submit" class="btn btn-primary">Valider</button>' +
          '<div class="acct-msg" role="alert" hidden></div>' +
        '</form>' +
        '<div class="acct-alt"><a data-action="forgot">Renvoyer un code</a> · <a data-action="to-login">Retour</a></div>' +
      '</div>';
  }

  function pfield(name, label, value, type) {
    return '<div class="acct-field"><label>' + label + '</label>' +
      '<input type="' + (type || 'text') + '" name="' + name + '" value="' + esc(value || '') + '" autocomplete="off"></div>';
  }
  function viewProfile(p) {
    var lien = (p.social_links && p.social_links[0] && p.social_links[0].url) || '';
    return '' +
      '<div class="acct-head acct-head-row">' +
        '<button class="acct-back" data-action="to-account" aria-label="Retour">' + ico('<path d="M15 18l-6-6 6-6"/>') + '</button>' +
        '<div><div class="title">Mon profil</div><div class="sub">Complète quand tu veux</div></div>' +
      '</div>' +
      '<div class="acct-body">' +
        '<form class="acct-form" data-mode="profile">' +
          pfield('prenom', 'Prénom', p.prenom) +
          pfield('nom', 'Nom', p.nom) +
          pfield('pseudo', 'Pseudo', p.pseudo) +
          pfield('telephone', 'Téléphone', p.telephone, 'tel') +
          pfield('adresse', 'Adresse', p.adresse) +
          pfield('lien', 'Lien (Instagram, TikTok…)', lien, 'url') +
          '<button type="submit" class="btn btn-primary">Enregistrer</button>' +
          '<div class="acct-msg" role="alert" hidden></div>' +
        '</form>' +
      '</div>';
  }

  // ---- Montage ----
  function mount(btn) {
    var wrap = document.createElement('div');
    wrap.className = 'nav-account';
    btn.parentNode.insertBefore(wrap, btn);
    wrap.appendChild(btn);
    var menu = document.createElement('div');
    menu.className = 'acct-menu';
    wrap.appendChild(menu);

    function renderButton() {
      var label = btn.querySelector('.label');
      var badge = btn.querySelector('.nav-token-badge');
      if (profile) {
        if (label) label.textContent = profile.prenom || (profile.email ? profile.email.split('@')[0] : 'Mon compte');
        if (!badge) { badge = document.createElement('span'); badge.className = 'nav-token-badge'; btn.appendChild(badge); }
        badge.textContent = parseInt(profile.tokens, 10) || 0;
      } else {
        if (label) label.textContent = 'Mon compte';
        if (badge) badge.remove();
      }
    }
    function renderMenu() {
      if (!profile) {
        if (authMode === 'forgot-email') menu.innerHTML = viewForgotEmail();
        else if (authMode === 'forgot-code') menu.innerHTML = viewForgotCode(forgotEmail);
        else menu.innerHTML = viewAuth(authMode);
      }
      else if (view === 'library') menu.innerHTML = viewLibrary(profile);
      else if (view === 'profile') menu.innerHTML = viewProfile(profile);
      else menu.innerHTML = viewAccount(profile);
    }
    function open() { renderMenu(); menu.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
    function close() { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    function toggle() { menu.classList.contains('open') ? close() : open(); }

    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function (e) { e.preventDefault(); toggle(); });

    function setProfile(p) { profile = p; view = 'account'; renderButton(); renderMenu(); }
    function clearProfile() { profile = null; authMode = 'login'; view = 'auth'; renderButton(); renderMenu(); }
    function flashMsg(text) { var box = menu.querySelector('.acct-msg'); if (box) { box.textContent = text; box.hidden = false; } }

    // Actions (délégation)
    menu.addEventListener('click', function (e) {
      var act = e.target.closest('[data-action]');
      if (!act) return;
      e.preventDefault();
      var action = act.getAttribute('data-action');
      if (action === 'to-signup') { authMode = 'signup'; renderMenu(); }
      else if (action === 'to-login') { authMode = 'login'; renderMenu(); }
      else if (action === 'to-account') { view = 'account'; renderMenu(); }
      else if (action === 'profile') { view = 'profile'; renderMenu(); }
      else if (action === 'library') { view = 'library'; renderMenu(); }
      else if (action === 'forgot') { authMode = 'forgot-email'; renderMenu(); }
      else if (action === 'logout') { doLogout(); }
    });

    // Soumission connexion / inscription
    menu.addEventListener('submit', function (e) {
      var form = e.target.closest('.acct-form');
      if (!form) return;
      e.preventDefault();
      var mode = form.getAttribute('data-mode');
      if (mode === 'profile') { submitProfile(form); return; }
      if (mode === 'forgot-request') { submitForgotRequest(form); return; }
      if (mode === 'forgot-confirm') { submitForgotConfirm(form); return; }
      var email = form.email.value.trim();
      var password = form.password.value;
      if (password.length < 8) { flashMsg('Mot de passe : 8 caractères minimum.'); return; }
      var btnEl = form.querySelector('button[type=submit]');
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }

      api('/auth/' + (mode === 'signup' ? 'signup' : 'login'), {
        method: 'POST', body: JSON.stringify({ email: email, password: password }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) { flashMsg(errMsg(res.j.error)); resetBtn(btnEl, mode); return; }
          if (res.j.token) localStorage.setItem(TOKEN_KEY, res.j.token); // conserve la clé de session
          if (mode === 'signup') {
            // Inscription réussie : la roue révèle le bonus (serveur = res.j.tokens déjà crédité).
            close();
            showWheel({
              target: (typeof res.j.signup_bonus === 'number') ? res.j.signup_bonus : null,
              onDone: function () { setProfile(res.j); },
            });
          } else { setProfile(res.j); }
        })
        .catch(function () {
          // API injoignable : en local, repli démo pour garder le menu explorable.
          if (IS_LOCAL) {
            if (mode === 'signup') {
              close();
              showWheel({ onDone: function (amount) { var p = demoProfile(email); p.tokens = amount; demoSet(p); setProfile(p); } });
            } else { var p = demoProfile(email); demoSet(p); setProfile(p); }
          } else { flashMsg('Service momentanément indisponible.'); resetBtn(btnEl, mode); }
        });
    });

    function resetBtn(btnEl, mode) {
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = mode === 'signup' ? 'Créer mon compte' : 'Se connecter'; }
    }
    function errMsg(code) {
      return {
        email_invalide: 'E-mail invalide.',
        mdp_trop_court: 'Mot de passe : 8 caractères minimum.',
        email_deja_utilise: 'Un compte existe déjà avec cet e-mail.',
        identifiants_invalides: 'E-mail ou mot de passe incorrect.',
      }[code] || 'Une erreur est survenue.';
    }

    function submitForgotRequest(form) {
      var email = form.email.value.trim();
      if (!email) { flashMsg('Renseigne ton e-mail.'); return; }
      var btnEl = form.querySelector('button[type=submit]');
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }
      api('/auth/reset-request', { method: 'POST', body: JSON.stringify({ email: email }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) {
            flashMsg(res.j && res.j.error === 'envoi_impossible'
              ? 'L\'envoi d\'e-mail n\'est pas encore activé.' : 'Impossible d\'envoyer le code.');
            if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Recevoir un code'; } return;
          }
          forgotEmail = email; authMode = 'forgot-code'; renderMenu();
        })
        .catch(function () { flashMsg('Service indisponible.'); if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Recevoir un code'; } });
    }

    function submitForgotConfirm(form) {
      var code = form.code.value.trim();
      var password = form.password.value;
      if (password.length < 8) { flashMsg('Mot de passe : 8 caractères minimum.'); return; }
      var btnEl = form.querySelector('button[type=submit]');
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }
      api('/auth/reset-confirm', { method: 'POST', body: JSON.stringify({ email: forgotEmail, code: code, password: password }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) { flashMsg('Code invalide ou expiré.'); if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Valider'; } return; }
          if (res.j.token) localStorage.setItem(TOKEN_KEY, res.j.token);
          authMode = 'login'; setProfile(res.j); // connecté avec le nouveau mot de passe
        })
        .catch(function () { flashMsg('Service indisponible.'); if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Valider'; } });
    }

    function doLogout() {
      demoClear();
      localStorage.removeItem(TOKEN_KEY);
      api('/auth/logout', { method: 'POST' }).catch(function () {}).then(function () { clearProfile(); });
    }

    function submitProfile(form) {
      var payload = {
        prenom: form.prenom.value.trim(),
        nom: form.nom.value.trim(),
        pseudo: form.pseudo.value.trim(),
        telephone: form.telephone.value.trim(),
        adresse: form.adresse.value.trim(),
        social_links: form.lien.value.trim() ? [{ reseau: '', url: form.lien.value.trim() }] : [],
      };
      var btnEl = form.querySelector('button[type=submit]');
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }
      api('/auth/profile', { method: 'POST', body: JSON.stringify(payload) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) { flashMsg('Enregistrement impossible.'); if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Enregistrer'; } return; }
          profile = res.j; view = 'account'; renderButton(); renderMenu();
        })
        .catch(function () {
          if (IS_LOCAL) { // repli démo : fusionne dans la session locale
            var d = demoGet() || demoProfile(profile ? profile.email : 'demo@local');
            Object.assign(d, payload);
            demoSet(d); profile = d; view = 'account'; renderButton(); renderMenu();
          } else { flashMsg('Service momentanément indisponible.'); if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Enregistrer'; } }
        });
    }

    // Fermer au clic extérieur / Échap.
    // On marque les clics internes sur `wrap` lui-même (robuste au re-render qui
    // détache la cible : wrap.contains(target) échouerait sur un noeud détaché).
    var insideClick = false;
    wrap.addEventListener('click', function () { insideClick = true; });
    document.addEventListener('click', function () { if (insideClick) { insideClick = false; return; } close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    // État initial : /auth/me (repli démo en local si non authentifié / API injointe)
    function restoreDemo() { if (IS_LOCAL) { var d = demoGet(); if (d) { profile = d; view = 'account'; } } }
    api('/auth/me')
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.authenticated) { profile = j; view = 'account'; } else restoreDemo(); renderButton(); })
      .catch(function () { restoreDemo(); renderButton(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('.nav-account-btn');
    if (btn) mount(btn);
  });
})();
