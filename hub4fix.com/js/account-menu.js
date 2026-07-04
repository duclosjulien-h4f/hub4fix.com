/**
 * Hub4Fix — menu compte + toggle "mode démo" partagé (site statique).
 *
 * Remplace le menu compte codé à la main de chaque page par un composant unique :
 *  - toggle "Mode démo" dans le header (état mémorisé en localStorage) ;
 *  - sélecteur de contexte Client / Partenaire ;
 *  - redondance corrigée : "Devenir X" (visiteur) OU "X" actif (démo), jamais les deux ;
 *  - tokens virtuels affichés en mode démo.
 *
 * Le mode démo du site statique est une SIMULATION (aucun effet réel) ; l'espace
 * partenaire réel (auth Zitadel) vit sur h4f-partenaire.*.workers.dev.
 *
 * Usage : <script src="js/account-menu.js"></script> en fin de <body>.
 */
(function () {
  var DEMO_KEY = 'h4f_demo', CTX_KEY = 'h4f_ctx', CLIENT_KEY = 'h4f_client_session';
  var PARTNER_URL = 'https://h4f-partenaire.duclosjulien.workers.dev';
  function demoOn() { try { return localStorage.getItem(DEMO_KEY) === '1'; } catch (e) { return false; } }
  function setDemo(v) { try { v ? localStorage.setItem(DEMO_KEY, '1') : localStorage.removeItem(DEMO_KEY); } catch (e) {} }
  function ctx() { try { return localStorage.getItem(CTX_KEY) || 'client'; } catch (e) { return 'client'; } }
  function setCtx(c) { try { localStorage.setItem(CTX_KEY, c); } catch (e) {} }
  // Session client légère (B2C) : alimente le même pipeline de lead que les
  // partenaires (worker/collect-email.js), sans back-end de session réel —
  // à remplacer par une vraie auth serveur si un espace client complet naît.
  function clientSession() { try { return JSON.parse(localStorage.getItem(CLIENT_KEY) || 'null'); } catch (e) { return null; } }
  function setClientSession(s) { try { s ? localStorage.setItem(CLIENT_KEY, JSON.stringify(s)) : localStorage.removeItem(CLIENT_KEY); } catch (e) {} }

  var CSS =
    '.h4f-nav-tools{display:flex;align-items:center;gap:.8rem}' +
    '.h4f-demo-toggle{display:flex;align-items:center;gap:.5rem;border:none;background:none;cursor:pointer;font-family:inherit;font-size:.72rem;font-weight:600;color:#7A7268;padding:.2rem}' +
    '.h4f-demo-toggle .h4f-track{width:40px;height:21px;border-radius:21px;background:#D4C9B8;position:relative;transition:background .3s}' +
    '.h4f-demo-toggle .h4f-knob{position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .3s,box-shadow .3s,background .3s}' +
    '.h4f-demo-toggle.on{color:#1f6b46}' +
    '.h4f-demo-toggle.on .h4f-track{background:#2D8B5E;animation:h4fLed .6s ease}' +
    '.h4f-demo-toggle.on .h4f-knob{left:21px;background:#eafff3;box-shadow:0 0 8px 1px rgba(45,139,94,.95),0 0 0 2px rgba(45,139,94,.4)}' +
    '@keyframes h4fLed{0%{box-shadow:0 0 0 0 rgba(45,139,94,.55)}70%{box-shadow:0 0 0 7px rgba(45,139,94,0)}100%{box-shadow:0 0 0 0 rgba(45,139,94,0)}}' +
    '#h4f-demo-wm{position:fixed;inset:0;z-index:9998;pointer-events:none;background-repeat:repeat}' +
    '.h4f-acc{position:relative}' +
    '.h4f-acc-btn{display:flex;align-items:center;gap:.3rem;background:none;border:none;cursor:pointer;padding:.3rem;border-radius:4px}' +
    '.h4f-acc-btn:hover{background:#EDE6DC}' +
    '.h4f-acc-ic{width:22px;height:22px;color:#3B3632}' +
    '.h4f-badge{background:#B8963E;color:#fff;font-size:.62rem;font-weight:700;min-width:17px;height:17px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 5px}' +
    '.h4f-menu{position:absolute;top:calc(100% + 8px);right:0;width:300px;background:#fff;border:1px solid #EDE6DC;border-radius:10px;box-shadow:0 16px 48px rgba(0,0,0,.12);display:none;z-index:300;overflow:hidden;font-family:inherit}' +
    '.h4f-menu.open{display:block;animation:h4fUp .2s ease}' +
    '@keyframes h4fUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
    '.h4f-head{padding:1rem 1.1rem;border-bottom:1px solid #EDE6DC;display:flex;justify-content:space-between;align-items:center}' +
    '.h4f-head .nm{font-weight:600;font-size:.9rem;color:#1C1A18}.h4f-head .em{font-size:.72rem;color:#7A7268;margin-top:.1rem}' +
    '.h4f-tok{display:flex;align-items:center;gap:.3rem;background:rgba(184,150,62,.1);padding:3px 9px;border-radius:12px;color:#8a6d24;font-weight:700;font-size:.85rem}' +
    '.h4f-tabs{display:flex;border-bottom:1px solid #EDE6DC}' +
    '.h4f-tab{flex:1;text-align:center;padding:.6rem;font-size:.78rem;font-weight:600;color:#7A7268;cursor:pointer;border-bottom:2px solid transparent;background:none;border-top:none;border-left:none;border-right:none;font-family:inherit}' +
    '.h4f-tab.active{color:#1C1A18;border-bottom-color:#C8102E}' +
    '.h4f-body{padding:.5rem}' +
    '.h4f-item{display:flex;align-items:center;gap:.6rem;padding:.65rem .8rem;border-radius:7px;text-decoration:none;color:#1C1A18;font-size:.85rem;font-weight:500}' +
    '.h4f-item:hover{background:#F3EEE8}' +
    '.h4f-item .d{font-weight:400;color:#7A7268;font-size:.72rem}' +
    '.h4f-item .badge-cta{margin-left:auto;font-size:.62rem;font-weight:700;color:#C8102E;border:1px solid #C8102E;border-radius:5px;padding:.05rem .35rem}' +
    '.h4f-item.active-role{background:#f5f0ff}' +
    '.h4f-links{border-top:1px solid #EDE6DC;padding:.3rem}' +
    '.h4f-links a{display:block;padding:.55rem .8rem;border-radius:7px;text-decoration:none;color:#3B3632;font-size:.82rem}' +
    '.h4f-links a:hover{background:#F3EEE8}.h4f-links a.out{color:#7A7268}';

  var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

  // Filigrane "DÉMO" plein écran, diagonale, très discret (présent en mode démo).
  function ensureWatermark(on) {
    var ex = document.getElementById('h4f-demo-wm');
    if (!on) { if (ex) ex.remove(); return; }
    if (ex) return;
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='190'>" +
      "<text x='6' y='120' font-family='Karla,Arial,sans-serif' font-size='38' font-weight='700' " +
      "fill='#1C1A18' fill-opacity='0.045' transform='rotate(-28 150 95)'>DÉMO</text></svg>";
    var wm = document.createElement('div');
    wm.id = 'h4f-demo-wm';
    wm.style.backgroundImage = 'url("data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))) + '")';
    document.body.appendChild(wm);
  }

  function tokenBadge(on) { return on ? '<span class="h4f-badge">5</span>' : ''; }

  function bodyHtml(on, c) {
    if (c === 'client') {
      return '<a class="h4f-item" href="hotlist.html"><span>Réparer</span><span class="d">— trouver une pièce</span></a>' +
             '<a class="h4f-item" href="hotlist.html"><span>Catalogue</span><span class="d">— pièces disponibles</span></a>';
    }
    // partenaire
    if (on) {
      return '<a class="h4f-item active-role" href="' + PARTNER_URL + '"><span>Espace Printer</span><span class="d">— mes impressions</span></a>' +
             '<a class="h4f-item active-role" href="' + PARTNER_URL + '"><span>Espace Modélisateur</span><span class="d">— mes modèles</span></a>';
    }
    return '<a class="h4f-item" href="printer.html"><span>Devenir Printer</span><span class="badge-cta">S\'inscrire</span></a>' +
           '<a class="h4f-item" href="modelisateur.html"><span>Devenir Modélisateur</span><span class="badge-cta">S\'inscrire</span></a>';
  }

  function menuHtml(on) {
    var c = ctx();
    var cs = !on ? clientSession() : null;
    var head = on
      ? '<div><div class="nm">Compte Démo</div><div class="em">demo@hub4fix.com</div></div><div class="h4f-tok">⬡ 5</div>'
      : (cs
        ? '<div><div class="nm">' + (cs.prenom || 'Client') + '</div><div class="em">' + cs.email + '</div></div>'
        : '<div><div class="nm">Visiteur</div><div class="em">Non connecté</div></div>');
    var exitLabel = on ? 'Quitter la démo' : (cs ? 'Se déconnecter' : 'Se connecter');
    return '<button class="h4f-acc-btn" id="h4fAccBtn" aria-label="Compte">' +
      '<svg class="h4f-acc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0112 0v1"/></svg>' +
      tokenBadge(on) + '</button>' +
      '<div class="h4f-menu" id="h4fMenu">' +
        '<div class="h4f-head">' + head + '</div>' +
        '<div class="h4f-tabs">' +
          '<button class="h4f-tab' + (c === 'client' ? ' active' : '') + '" data-ctx="client">Client</button>' +
          '<button class="h4f-tab' + (c === 'partenaire' ? ' active' : '') + '" data-ctx="partenaire">Partenaire</button>' +
        '</div>' +
        '<div class="h4f-body">' + bodyHtml(on, c) + '</div>' +
        '<div class="h4f-links">' +
          '<a href="mon-compte.html">Mon compte</a>' +
          '<a href="#" class="out" id="h4fExit">' + exitLabel + '</a>' +
        '</div>' +
      '</div>';
  }

  function render() {
    var nav = document.querySelector('nav'); if (!nav) return;
    var right = nav.querySelector('.nav-right') || nav;
    // masque (sans supprimer) l'ancien menu codé en dur, pour ne pas casser
    // le JS en ligne des pages qui le référence encore ; + nettoie un rendu précédent
    var old = nav.querySelector('.nav-account'); if (old) old.style.display = 'none';
    var prev = document.getElementById('h4f-tools'); if (prev) prev.remove();

    var on = demoOn();
    ensureWatermark(on);
    var tools = document.createElement('div');
    tools.className = 'h4f-nav-tools'; tools.id = 'h4f-tools';
    tools.innerHTML =
      '<button class="h4f-demo-toggle' + (on ? ' on' : '') + '" id="h4fDemo" title="Mode démo" aria-pressed="' + on + '">' +
        '<span class="h4f-track"><span class="h4f-knob"></span></span><span>Démo</span></button>' +
      '<div class="h4f-acc">' + menuHtml(on) + '</div>';
    right.appendChild(tools);

    // toggle démo
    document.getElementById('h4fDemo').addEventListener('click', function () { setDemo(!demoOn()); render(); });

    // ouverture du menu
    var btn = document.getElementById('h4fAccBtn'), menu = document.getElementById('h4fMenu');
    btn.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('open'); });
    document.addEventListener('click', function () { menu.classList.remove('open'); });
    menu.addEventListener('click', function (e) { e.stopPropagation(); });

    // onglets de contexte
    tools.querySelectorAll('.h4f-tab').forEach(function (t) {
      t.addEventListener('click', function () { setCtx(t.getAttribute('data-ctx')); render(); document.getElementById('h4fMenu').classList.add('open'); });
    });

    // quitter démo / se déconnecter / se connecter
    var exit = document.getElementById('h4fExit');
    if (exit) exit.addEventListener('click', function (e) {
      e.preventDefault();
      if (on) { setDemo(false); render(); return; }
      if (clientSession()) { setClientSession(null); render(); return; }
      if (ctx() === 'client') { if (window.H4FClientAuth) window.H4FClientAuth.open(); return; }
      window.location.href = PARTNER_URL;
    });
  }

  // API exposée pour js/client-auth.js et js/access-gate.js (léger, sans back-end réel)
  window.H4FAccount = {
    render: render,
    setClientSession: function (s) { setClientSession(s); render(); },
    clientSession: clientSession,
    demoOn: demoOn,
    setDemo: function (v) { setDemo(v); render(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
