/**
 * Espace partenaire (SPA légère) SERVI PAR le worker h4f-partner — même origine que
 * les endpoints, donc le cookie de session suffit (pas de CORS, pas de custom domain).
 *
 * Un seul écran qui s'adapte à /auth/me :
 *   - non connecté        -> bouton « Se connecter » (Zitadel)
 *   - connecté, pas actif  -> formulaire de candidature (ou « en attente »)
 *   - modélisateur actif   -> Hot List + réservation (upload plaque/objet)
 *
 * Le worker injecte APP_HTML tel quel. `?api=` permet de pointer sur un mock en test.
 */
export const APP_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Espace partenaire — Hub4Fix</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20viewBox%3D'0%200%20202.6%20265.4'%3E%3Cg%20transform%3D'translate(-129.894%2C-634.847)'%20fill%3D'%232563EB'%3E%3Cpath%20d%3D'm%20234.225%2C648.032%20-24.32%2C66.818%20a%2037.795%2C37.795%200%200%200%2035.516%2C50.722%20h%2072.08%20a%209.449%2C9.449%200%200%201%200%2C18.898%20h%20-72.08%20a%2056.693%2C56.693%200%200%201%20-53.274%2C-76.083%20l%2024.323%2C-66.826%20a%209.449%2C9.449%200%200%201%2017.755%2C6.471%20z'%2F%3E%3Cpath%20d%3D'm%20195.773%2C883.258%20a%209.449%2C9.449%200%201%200%2017.758%2C6.463%20l%2036.933%2C-101.472%20-5.045%2C0%20a%2060.472%2C60.472%200%200%201%20-14.43%2C-1.747%20z'%2F%3E%3Cpath%20d%3D'm%20130.881%2C876.724%20a%209.449%2C9.449%200%200%200%2017.842%2C6.223%20l%2045.037%2C-123.737%20a%2060.472%2C60.472%200%200%201%20-8.81%2C-31.039%20z'%2F%3E%3Cpath%20d%3D'm%20240.133%2C761.379%20a%2034.016%2C34.016%200%200%200%205.287%2C0.413%20h%2014.673%20l%2041.406%2C-113.761%20a%209.449%2C9.449%200%200%200%20-17.758%2C-6.463%20z'%2F%3E%3Cpath%20d%3D'm%20317.5%2C740.871%20a%209.449%2C9.449%200%200%200%200%2C-18.898%20h%20-38.892%20l%20-6.878%2C18.898%20z'%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E">
<style>
  :root { --cream:#FDFAF5; --ink:#1E1B18; --muted:#6B6259; --line:#E5DDD1; --red:#C0392B; --green:#2D8B5E; --gold:#B8963E; --panel:#fff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--cream); color:var(--ink); font-family:-apple-system,"Segoe UI",system-ui,sans-serif; line-height:1.55; }
  header { display:flex; align-items:center; gap:.7rem; padding:1rem 1.4rem; border-bottom:1px solid var(--line); background:#FBF7F1; }
  .brand { font-family:Georgia,serif; font-weight:600; font-size:1.05rem; }
  .brand sup { color:var(--red); }
  .tag-space { font-size:.7rem; letter-spacing:.1em; text-transform:uppercase; color:var(--gold); border:1px solid var(--gold); border-radius:20px; padding:.15rem .6rem; }
  header .right { margin-left:auto; display:flex; gap:.6rem; align-items:center; font-size:.82rem; color:var(--muted); }
  header a.logout { color:var(--muted); text-decoration:none; border:1px solid var(--line); border-radius:20px; padding:.3rem .8rem; }
  main { max-width:920px; margin:0 auto; padding:2rem 1.4rem 4rem; }
  h1 { font-family:Georgia,serif; font-size:1.7rem; margin:0 0 .3rem; }
  .sub { color:var(--muted); margin:0 0 1.8rem; }
  .btn { display:inline-flex; align-items:center; gap:.4rem; border:none; border-radius:8px; padding:.7rem 1.3rem; font:inherit; font-weight:600; cursor:pointer; background:var(--green); color:#fff; text-decoration:none; }
  .btn.secondary { background:#fff; color:var(--ink); border:1px solid var(--line); }
  .btn.red { background:var(--red); }
  .btn:disabled { opacity:.5; cursor:default; }
  .card { border:1px solid var(--line); border-radius:12px; background:var(--panel); padding:1.4rem; }
  .field { margin-bottom:1rem; }
  .field label { display:block; font-size:.82rem; font-weight:600; margin-bottom:.35rem; }
  .field input, .field textarea { width:100%; border:1px solid var(--line); border-radius:8px; padding:.6rem .8rem; font:inherit; background:#fff; }
  .field textarea { min-height:110px; resize:vertical; }
  .msg { padding:.7rem 1rem; border-radius:8px; font-size:.9rem; margin-bottom:1rem; }
  .msg.err { background:#FBEDEC; color:var(--red); }
  .msg.ok { background:#EAF6F0; color:var(--green); }
  /* Hot List */
  .grid { display:flex; flex-direction:column; gap:.7rem; }
  .piece { display:flex; gap:.9rem; align-items:center; border:1px solid var(--line); border-radius:10px; background:#fff; padding:.8rem 1rem; }
  .piece .ph { width:52px; height:52px; border-radius:8px; flex:none; background:linear-gradient(135deg,#EFE9DF,#DDD3C4); display:flex; align-items:center; justify-content:center; font-size:1.3rem; }
  .piece .info { flex:1; min-width:0; }
  .piece .nom { font-weight:600; font-size:.92rem; }
  .piece .meta { color:var(--muted); font-size:.78rem; }
  .piece .stats { font-size:.74rem; color:var(--muted); margin-top:.15rem; }
  .badge { font-size:.7rem; font-weight:600; padding:.2rem .55rem; border-radius:20px; white-space:nowrap; }
  .badge.mine { color:var(--green); background:#EAF6F0; }
  .badge.taken { color:var(--muted); background:#F0ECE4; }
  .boost { color:var(--gold); font-weight:600; }
  /* Réservation / upload */
  .drop { border:1.5px dashed var(--line); border-radius:10px; padding:1rem; text-align:center; cursor:pointer; background:#fff; }
  .drop:hover { border-color:var(--green); }
  .drop img { max-width:100%; max-height:160px; border-radius:8px; margin-top:.5rem; }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
  .three { display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; }
  @media (max-width:760px){ .three { grid-template-columns:1fr 1fr; } }
  @media (max-width:560px){ .two, .three { grid-template-columns:1fr; } }
  .opt { font-weight:400; font-size:.72rem; color:var(--muted); }
  /* Néon d'activité (upload + validation IA) */
  @property --neon-angle { syntax:'<angle>'; initial-value:0deg; inherits:false; }
  .neon { position:relative; display:inline-flex; border-radius:10px; }
  .neon::before { content:''; position:absolute; inset:-2px; border-radius:12px; padding:2px;
    background:conic-gradient(from var(--neon-angle), transparent 0deg,#2D8B5E 55deg,#4FD1A0 110deg,#7CE0FF 165deg,transparent 250deg,transparent 360deg);
    -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); -webkit-mask-composite:xor;
    mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); mask-composite:exclude; opacity:0; transition:opacity .3s; pointer-events:none; }
  .neon.active::before { opacity:1; animation:neon-spin 1.3s linear infinite; }
  .neon.active { box-shadow:0 0 16px rgba(79,209,160,.45); }
  @keyframes neon-spin { to { --neon-angle:360deg; } }
  @media (prefers-reduced-motion:reduce){ .neon.active::before { animation:none; } }
  .muted { color:var(--muted); }
  .spin { display:inline-block; width:14px; height:14px; border:2px solid rgba(255,255,255,.4); border-top-color:#fff; border-radius:50%; animation:sp .7s linear infinite; }
  @keyframes sp { to { transform:rotate(360deg); } }
  /* Cartes de rôle (hub) + options de parc */
  .rolecard { border:1px solid var(--line); border-radius:12px; background:#fff; padding:1.2rem; display:flex; flex-direction:column; }
  .rolecard h3 { margin:.1rem 0 .3rem; font-size:1.05rem; }
  .rolecard .rc-desc { color:var(--muted); font-size:.85rem; margin:0 0 1rem; flex:1; }
  .opts { display:flex; flex-wrap:wrap; gap:.4rem; margin:.15rem 0 .2rem; }
  .opt { border:1px solid var(--line); background:#fff; border-radius:20px; padding:.35rem .8rem; font-size:.82rem; cursor:pointer; user-select:none; }
  .opt.on { border-color:var(--green); background:#EAF6F0; color:var(--green); font-weight:600; }
  .politesse { background:#FBF7EC; border:1px solid rgba(184,150,62,.3); border-radius:8px; padding:.8rem 1rem; font-size:.8rem; color:var(--muted); margin:1rem 0; line-height:1.5; }
  .toggle { display:inline-flex; align-items:center; gap:.5rem; font-size:.88rem; cursor:pointer; }
  /* Parc machines : ligne = [sélecteur cascade] [quantité] [retirer] */
  .mrow { display:grid; grid-template-columns:1fr 62px 34px; gap:.4rem; margin-bottom:.5rem; align-items:start; }
  .mrow > .ps-host { min-width:0; }
  .mrow .m-qte { border:1px solid var(--line); border-radius:8px; padding:.55rem .4rem; font:inherit; background:#fff; width:100%; text-align:center; }
  .mrow .m-remove { border:1px solid var(--line); background:#fff; border-radius:8px; cursor:pointer; color:var(--muted); height:38px; font-size:1.1rem; line-height:1; }
  .mrow .m-remove:hover { border-color:var(--red); color:var(--red); }
  .add-machine { border:1px dashed var(--line); background:#fff; border-radius:8px; padding:.5rem .9rem; font:inherit; font-size:.82rem; font-weight:600; color:var(--muted); cursor:pointer; margin-top:.1rem; }
  .add-machine:hover { border-color:var(--green); color:var(--green); }
  /* Les styles .ps* (pastilles du sélecteur) sont injectés par /js/printer-selector.js */
  @media (max-width:560px){ .mrow { grid-template-columns:1fr 52px 30px; } }
  /* Commandes printer (P2) */
  .jobhead { display:flex; align-items:center; gap:.6rem; margin-bottom:.6rem; }
  .jobhead .t { font-weight:600; }
  .jobhead .seed { margin-left:auto; font-size:.78rem; padding:.4rem .8rem; }
  .jobc .info { display:flex; flex-direction:column; gap:.15rem; }
  .clockrow { display:flex; align-items:center; gap:.5rem; margin-top:.35rem; flex-wrap:wrap; }
  /* Suivi de production : 3 slide-to-confirm (lancement -> réussite -> expédition) */
  .prod { display:flex; flex-direction:column; gap:.45rem; margin-top:.6rem; }
  .slide { position:relative; height:40px; border-radius:20px; background:#F0ECE4; border:1px solid var(--line);
    overflow:hidden; user-select:none; touch-action:none; }
  .slide .fill { position:absolute; left:0; top:0; bottom:0; width:37px; background:var(--green); opacity:.15; border-radius:20px; }
  .slide .lbl { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:0 2.6rem;
    font-size:.78rem; font-weight:600; color:var(--muted); pointer-events:none; text-align:center; }
  .slide .thumb { position:absolute; left:3px; top:3px; width:34px; height:32px; border-radius:16px; background:var(--green);
    color:#fff; display:flex; align-items:center; justify-content:center; font-size:1.25rem; cursor:grab; touch-action:none;
    box-shadow:0 1px 3px rgba(0,0,0,.22); transition:transform .15s ease; }
  .slide .thumb:active { cursor:grabbing; }
  .slide.done { background:#EAF6F0; border-color:var(--green); }
  .slide.done .lbl { color:var(--green); padding:0 1rem; }
  .slide.pending { opacity:.55; }
  .slide.pending .thumb { background:var(--muted); cursor:default; }
  .minejob .info { width:100%; }
  /* Horloge à bascule (VRAI split-flap) — HH:MM:SS. La moitié BASSE reste fixe ; la
     moitié HAUTE (ancien chiffre) bascule vers le bas (rotateX autour de la pliure) et
     se rabat sur la basse, révélant le nouveau chiffre. Chaque moitié affiche le chiffre
     PLEIN (1.7em) et n'en montre que sa moitié (overflow). */
  .flip { display:inline-flex; gap:.14rem; align-items:center; font-variant-numeric:tabular-nums; }
  .flip .sep { color:var(--muted); font-weight:700; }
  .digit { position:relative; display:inline-block; width:1.35em; height:1.7em; perspective:230px;
    font:700 1.05rem/1 "Courier New",monospace; }
  .digit .half { position:absolute; left:0; right:0; height:50%; overflow:hidden; background:#2C2C2A; color:#F3EFE7; }
  .digit .half .d { position:absolute; left:0; right:0; height:1.7em; line-height:1.7em; text-align:center; }
  .digit .upper, .digit .fr { top:0; border-radius:5px 5px 0 0; box-shadow:inset 0 1px 0 rgba(255,255,255,.06); }
  .digit .lower, .digit .bk { bottom:0; border-radius:0 0 5px 5px; }
  .digit .upper .d, .digit .fr .d { top:0; }        /* montre le HAUT du chiffre */
  .digit .lower .d, .digit .bk .d { bottom:0; }      /* montre le BAS du chiffre */
  .digit .fr { z-index:3; transform-origin:50% 100%; backface-visibility:hidden; border-bottom:2px solid rgba(255,255,255,.16); }
  .digit .upper { border-bottom:2px solid rgba(255,255,255,.16); }
  .digit .bk { z-index:2; transform-origin:50% 0%; transform:rotateX(90deg); backface-visibility:hidden; }
  .digit.flip .fr { animation:flip-fr .3s ease-in forwards; }
  .digit.flip .bk { animation:flip-bk .3s ease-out .3s forwards; }
  @keyframes flip-fr { to { transform:rotateX(-90deg); } }
  @keyframes flip-bk { to { transform:rotateX(0deg); } }
  .flip.exp .half { background:#5a2b28; color:#f7d7d3; }
  @media (prefers-reduced-motion:reduce){ .digit .fr, .digit .bk { animation:none !important; } .digit .bk { transform:rotateX(0); } }
</style>
</head>
<body>
<header>
  <span class="brand">Hub<sup>4</sup>Fix</span>
  <span class="tag-space">Espace partenaire</span>
  <div class="right" id="hdr"></div>
</header>
<main id="app"><p class="muted">Chargement…</p></main>

<!-- Sélecteur d'imprimante partagé (source unique) — servi même origine par le worker. -->
<script src="/js/printer-selector.js"></script>
<script>
(function () {
  'use strict';
  var API = new URLSearchParams(location.search).get('api') || '';
  var app = document.getElementById('app');
  var hdr = document.getElementById('hdr');
  var ME = null;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function api(path, opts){ return fetch(API + path, Object.assign({ credentials:'include', headers:{'Content-Type':'application/json'} }, opts)).then(function(r){ return r.json().then(function(d){ return { status:r.status, d:d }; }); }); }

  function statusOf(type){ return (ME && ME.partner && ME.partner[type]) || 'none'; }

  function load(){
    api('/auth/me').then(function(r){
      ME = r.d;
      renderHeader();
      if (!ME.authenticated) return screenLogin();
      return screenHome();
    }).catch(function(){ app.innerHTML = '<div class="msg err">Connexion au service impossible. Réessayez.</div>'; });
  }

  function renderHeader(){
    if (ME && ME.authenticated) hdr.innerHTML = esc(ME.email) + ' <a class="logout" href="'+API+'/auth/logout">Déconnexion</a>';
    else hdr.innerHTML = '';
  }

  function screenLogin(){
    app.innerHTML =
      '<h1>Espace partenaire</h1>' +
      '<p class="sub">Modélisez les pièces orphelines, ou imprimez et livrez les commandes de votre zone. Connectez-vous pour commencer.</p>' +
      '<a class="btn" href="'+API+'/auth/login?returnTo='+encodeURIComponent(location.pathname)+'">Se connecter</a>';
  }

  // Hub : deux rôles cumulables (modélisateur ET/OU printer), chacun selon son statut.
  function screenHome(){
    var roles = [
      { type:'modelisateur', icon:'🛠', title:'Modélisateur', desc:'Réservez les pièces de la Hot List et déposez vos modélisations.', enter:'Accéder à la Hot List', apply:'Devenir modélisateur' },
      { type:'printer', icon:'🖨', title:'Printer', desc:'Recevez et réservez les commandes d\\'impression de votre zone.', enter:'Accéder à l\\'espace printer', apply:'Devenir printer' }
    ];
    app.innerHTML = '<h1>Espace partenaire</h1><p class="sub">Choisissez un rôle. Vous pouvez cumuler les deux.</p>' +
      '<div class="two">' + roles.map(function(r){
        var st = statusOf(r.type);
        var action = st === 'active' ? '<button class="btn" data-enter="'+r.type+'">'+r.enter+'</button>'
          : st === 'pending' ? '<span class="badge taken" style="align-self:flex-start">Candidature en attente</span>'
          : '<button class="btn secondary" data-apply="'+r.type+'">'+r.apply+'</button>';
        return '<div class="rolecard"><h3>'+r.icon+' '+r.title+'</h3><div class="rc-desc">'+r.desc+'</div>'+action+'</div>';
      }).join('') + '</div>';
    [].forEach.call(app.querySelectorAll('[data-enter]'), function(b){
      b.addEventListener('click', function(){ b.getAttribute('data-enter') === 'printer' ? screenPrinter() : screenHotlist(); });
    });
    [].forEach.call(app.querySelectorAll('[data-apply]'), function(b){
      b.addEventListener('click', function(){ b.getAttribute('data-apply') === 'printer' ? screenPrinterApply() : screenApply(); });
    });
  }

  function backLink(fn, label){
    var a = document.createElement('a'); a.href='#'; a.className='muted'; a.style.cssText='text-decoration:none;font-size:.85rem';
    a.textContent = '← '+(label||'Retour');
    a.addEventListener('click', function(e){ e.preventDefault(); fn(); });
    return a;
  }

  function screenPending(type){
    var t = type === 'printer' ? 'printer' : 'modélisateur';
    var suite = type === 'printer' ? 'vous accéderez alors aux commandes de votre zone.' : 'vous accéderez alors à la Hot List.';
    app.innerHTML = '';
    app.appendChild(backLink(screenHome, 'Retour à l\\'espace partenaire'));
    app.insertAdjacentHTML('beforeend',
      '<h1 style="margin-top:.5rem">Candidature en cours d\\'examen</h1>' +
      '<p class="sub">Merci ! Votre candidature de '+t+' a bien été reçue. Un administrateur la validera prochainement ; '+suite+'</p>');
  }

  function screenApply(){
    app.innerHTML = '';
    app.appendChild(backLink(screenHome, 'Retour à l\\'espace partenaire'));
    app.insertAdjacentHTML('beforeend',
      '<h1 style="margin-top:.5rem">Devenir modélisateur</h1>' +
      '<p class="sub">Dites-nous en quelques mots votre expérience de la modélisation et de l\\'impression 3D. Un administrateur validera votre candidature.</p>' +
      '<div class="card">' +
        '<div id="applyMsg"></div>' +
        '<div class="field"><label>Votre motivation et votre expérience</label><textarea id="motivation" placeholder="Ex : je modélise des pièces techniques depuis 4 ans, imprimante FDM et résine…"></textarea></div>' +
        '<div class="field"><label>Portfolio (facultatif)</label><input id="portfolio" placeholder="https://… (site, Printables, Thingiverse)"></div>' +
        '<button class="btn" id="applyBtn">Envoyer ma candidature</button>' +
      '</div>');
    document.getElementById('applyBtn').addEventListener('click', submitApply);
  }

  function submitApply(){
    var btn = document.getElementById('applyBtn');
    var motivation = document.getElementById('motivation').value.trim();
    var portfolio = document.getElementById('portfolio').value.trim();
    var msg = document.getElementById('applyMsg');
    if (motivation.length < 20){ msg.innerHTML = '<div class="msg err">Décrivez un peu plus votre expérience (au moins une phrase).</div>'; return; }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Envoi…';
    api('/partner/apply', { method:'POST', body: JSON.stringify({ type:'modelisateur', motivation:motivation, portfolio:portfolio }) })
      .then(function(r){
        if (r.status === 201){ if (ME.partner) ME.partner.modelisateur='pending'; return screenPending('modelisateur'); }
        btn.disabled = false; btn.textContent = 'Envoyer ma candidature';
        msg.innerHTML = '<div class="msg err">'+(r.d.error === 'motivation_trop_courte' ? 'Motivation trop courte.' : 'Une candidature est déjà en cours.')+'</div>';
      })
      .catch(function(){ btn.disabled=false; btn.textContent='Envoyer ma candidature'; msg.innerHTML='<div class="msg err">Envoi impossible.</div>'; });
  }

  // ---- Printer : candidature (motivation + parc) ----
  var MATERIALS = ['PLA','PETG','ABS','ASA','TPU','nylon','resine'];
  function optChips(id, list, selected){
    selected = selected || [];
    return '<div class="opts" id="'+id+'">' + list.map(function(v){
      return '<span class="opt'+(selected.indexOf(v)>=0?' on':'')+'" data-v="'+v+'">'+v+'</span>';
    }).join('') + '</div>';
  }
  function bindChips(id){
    [].forEach.call(document.getElementById(id).querySelectorAll('.opt'), function(el){
      el.addEventListener('click', function(){ el.classList.toggle('on'); });
    });
  }
  function chipValues(id){
    return [].map.call(document.getElementById(id).querySelectorAll('.opt.on'), function(el){ return el.getAttribute('data-v'); });
  }

  // ---- Parc machines : sélecteur cascade (module partagé window.H4FPrinterSelector) ----
  // L'arbre (PRINTER_TREE), les couleurs marque et le widget vivent dans le fichier
  // partagé /js/printer-selector.js (chargé en bas de page) — SOURCE UNIQUE réutilisée par
  // produit.html. Ici on ne gère que la LISTE de machines du parc (ajout/retrait/quantité).
  function PS(){ return window.H4FPrinterSelector; }

  // Une ligne machine = [sélecteur] [quantité] [retirer].
  function machineRow(listEl, initial){
    var row = document.createElement('div'); row.className = 'mrow';
    row.innerHTML = '<div class="ps-host"></div>' +
      '<input class="m-qte" type="number" min="1" value="'+(initial&&initial.quantite?parseInt(initial.quantite,10)||1:1)+'" title="Quantité (lot identique)">' +
      '<button type="button" class="m-remove" aria-label="Retirer cette machine">×</button>';
    listEl.appendChild(row);
    PS().mount(row.querySelector('.ps-host'), { initial: initial || null, openNow: !initial });
    row.querySelector('.m-remove').onclick = function(){ if (listEl.querySelectorAll('.mrow').length > 1) listEl.removeChild(row); };
    return row;
  }
  function renderMachineList(listEl, machines){
    listEl.innerHTML = '';
    machines = (machines && machines.length) ? machines : [null];
    machines.forEach(function(m){ machineRow(listEl, m); });
  }
  // « + » : nouvelle ligne PRÉ-REMPLIE avec la dernière machine (repliée ; survol Marque = libère).
  function addMachineRow(listEl){
    var rows = listEl.querySelectorAll('.mrow'), last = rows[rows.length-1], init = null;
    if (last){ var s = last.querySelector('.ps-host')._sel; if (s && s.brand && s.model) init = { brand:s.brand, range:s.range, model:s.model, nozzle:s.nozzle, bed:s.bed, plate:s.plate, plateLabel:s.plateLabel, quantite:last.querySelector('.m-qte').value }; }
    machineRow(listEl, init);
  }
  function readMachineList(listEl){
    var out = [];
    [].forEach.call(listEl.querySelectorAll('.mrow'), function(r){
      var m = PS().read(r.querySelector('.ps-host'));
      if (!m) return;
      m.quantite = parseInt(r.querySelector('.m-qte').value, 10) || 1;
      out.push(m);
    });
    return out;
  }
  var POLITESSE = 'Le temps machine servant au calcul de votre rémunération est établi sur la base d\\'une imprimante de référence (Bambu Lab A1), afin de garantir une tarification équitable et homogène entre tous nos partenaires. Ce temps de référence ne peut être réévalué selon l\\'ancienneté ou les performances de votre matériel. Nous vous invitons à en tenir compte dans le choix de votre équipement.';
  // Le plateau de référence est VOLONTAIREMENT plus grand que celui de l'A1 réelle. Sans
  // cette extension, une pièce de plus de 256 mm n'aurait aucun temps de référence, donc
  // aucune rémunération calculable. Dit au printer parce qu'il verra la différence entre
  // le nom de la machine et la taille des pièces qu'on lui propose.
  // L'enveloppe est celle d'une machine RÉELLE (A2L), pas un plateau inventé : c'est ce qui
  // rend la phrase tenable devant un printer. On maintient quand même la distinction entre
  // ÉTALON et prévision — le temps reste calculé sur le profil A1.
  var POLITESSE_PLATEAU = 'Certaines pièces dépassent le plateau de cette imprimante de référence. Le calcul conserve alors son profil (vitesses, buse, hauteur de couche) et retient l\\'enveloppe de la Bambu Lab A2L, sa remplaçante grand format (330 × 320 × 325 mm) : une machine réelle, pas un format inventé. À profil constant, la taille du plateau n\\'entre pas dans l\\'estimation d\\'une pièce unique. Ce temps reste un étalon commun à tous les partenaires et non une prévision du temps que prendra votre machine. Enfin, l\\'enveloppe de référence ne dit rien de la compatibilité : celle-ci est vérifiée sur votre parc réel.';

  function screenPrinterApply(){
    app.innerHTML = '';
    app.appendChild(backLink(screenHome, 'Retour à l\\'espace partenaire'));
    app.insertAdjacentHTML('beforeend',
      '<h1 style="margin-top:.5rem">Devenir printer</h1>' +
      '<p class="sub">Décrivez votre parc et votre zone. Un administrateur validera votre candidature ; vous recevrez ensuite les commandes d\\'impression de votre secteur.</p>' +
      '<div class="card">' +
        '<div id="pMsg"></div>' +
        '<div class="field"><label>Votre motivation et votre expérience</label><textarea id="pmot" placeholder="Ex : je gère un atelier de 6 imprimantes depuis 3 ans…"></textarea></div>' +
        '<div class="field"><label>Parc machines <span style="font-weight:400;color:var(--muted);font-size:.72rem">— une ligne par imprimante (ou lot identique)</span></label>' +
          '<div id="pMachines"></div><button type="button" class="add-machine" id="pAddMachine">+ Ajouter une machine</button></div>' +
        '<div class="field"><label>Matériaux</label>'+optChips('pMats', MATERIALS)+'</div>' +
        '<div class="two">' +
          '<div class="field"><label>Code postal</label><input id="pcp" inputmode="numeric" placeholder="91170"></div>' +
          '<div class="field"><label>Ville</label><input id="pville" placeholder="Viry-Châtillon"></div>' +
        '</div>' +
        '<div class="politesse">'+POLITESSE+'<br><br>'+POLITESSE_PLATEAU+'</div>' +
        '<button class="btn" id="pApplyBtn">Envoyer ma candidature</button>' +
      '</div>');
    renderMachineList(document.getElementById('pMachines'), []);
    document.getElementById('pAddMachine').addEventListener('click', function(){ addMachineRow(document.getElementById('pMachines')); });
    bindChips('pMats');
    document.getElementById('pApplyBtn').addEventListener('click', submitPrinterApply);
  }

  function submitPrinterApply(){
    var btn = document.getElementById('pApplyBtn'), msg = document.getElementById('pMsg');
    var motivation = document.getElementById('pmot').value.trim();
    var machines = readMachineList(document.getElementById('pMachines')), materials = chipValues('pMats');
    var postal_code = document.getElementById('pcp').value.trim(), ville = document.getElementById('pville').value.trim();
    if (motivation.length < 20){ msg.innerHTML = '<div class="msg err">Décrivez un peu plus votre expérience.</div>'; return; }
    if (!machines.length){ msg.innerHTML = '<div class="msg err">Ajoutez au moins une machine (marque / modèle).</div>'; return; }
    if (!postal_code){ msg.innerHTML = '<div class="msg err">Indiquez votre code postal (pour le matching de zone).</div>'; return; }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Envoi…';
    api('/printer/apply', { method:'POST', body: JSON.stringify({ motivation:motivation, machines:machines, materials:materials, postal_code:postal_code, ville:ville }) })
      .then(function(r){
        if (r.status === 201){ if (ME.partner) ME.partner.printer='pending'; return screenPending('printer'); }
        btn.disabled=false; btn.textContent='Envoyer ma candidature';
        msg.innerHTML = '<div class="msg err">'+(r.d.error==='motivation_trop_courte'?'Motivation trop courte.':'Une candidature est déjà en cours.')+'</div>';
      })
      .catch(function(){ btn.disabled=false; btn.textContent='Envoyer ma candidature'; msg.innerHTML='<div class="msg err">Envoi impossible.</div>'; });
  }

  // ---- Printer : espace (v1 = profil parc modifiable + commandes à venir) ----
  function screenPrinter(){
    app.innerHTML = '';
    app.appendChild(backLink(screenHome, 'Retour à l\\'espace partenaire'));
    app.insertAdjacentHTML('beforeend', '<h1 style="margin-top:.5rem">Espace printer</h1><div id="pbody"><p class="muted">Chargement de votre parc…</p></div>');
    api('/printer/profile').then(function(r){
      var p = (r.d && r.d.profile) || { techs:'', materials:'', postal_code:'', ville:'', available:true, machines:[] };
      var mats = p.materials ? p.materials.split(',') : [];
      document.getElementById('pbody').innerHTML =
        '<div class="card"><div id="ppMsg"></div>' +
        '<div style="font-weight:600;margin-bottom:.6rem">Votre parc</div>' +
        '<div class="field"><label>Parc machines <span style="font-weight:400;color:var(--muted);font-size:.72rem">— une ligne par imprimante (ou lot identique)</span></label>' +
          '<div id="epMachines"></div><button type="button" class="add-machine" id="epAddMachine">+ Ajouter une machine</button></div>' +
        '<div class="field"><label>Matériaux</label>'+optChips('epMats', MATERIALS, mats)+'</div>' +
        '<div class="two">' +
          '<div class="field"><label>Code postal</label><input id="epcp" value="'+esc(p.postal_code)+'"></div>' +
          '<div class="field"><label>Ville</label><input id="epville" value="'+esc(p.ville)+'"></div>' +
        '</div>' +
        '<label class="toggle"><input type="checkbox" id="epavail"'+(p.available?' checked':'')+'> Disponible pour recevoir des commandes</label>' +
        '<div style="margin-top:1rem"><button class="btn" id="epSave">Enregistrer</button></div>' +
        '</div>' +
        '<div class="card" style="margin-top:1rem">' +
          '<div class="jobhead"><span class="t">Vos commandes</span>' +
            (ME && ME.is_admin ? '<button class="btn secondary seed" id="seedBtn">＋ Commande de test</button>' : '') +
          '</div>' +
          '<div id="jobs"><p class="muted" style="margin:0">Chargement des commandes…</p></div>' +
          '<div id="jobsRef"></div>' +
        '</div>';
      renderMachineList(document.getElementById('epMachines'), p.machines || []);
      document.getElementById('epAddMachine').addEventListener('click', function(){ addMachineRow(document.getElementById('epMachines')); });
      bindChips('epMats');
      document.getElementById('epSave').addEventListener('click', savePrinterProfileFront);
      var seed = document.getElementById('seedBtn');
      if (seed) seed.addEventListener('click', seedTestJob);
      loadPrinterJobs();
    });
  }

  // ---- Printer : commandes réservables (P2) ----
  var jobTimers = [];
  function clearJobTimers(){ jobTimers.forEach(function(stop){ try { stop(); } catch(e){} }); jobTimers = []; }
  function eurosFront(c){ return (Math.round(Number(c)||0)/100).toFixed(2).replace('.',',')+' €'; }

  function loadPrinterJobs(){
    clearJobTimers();
    var box = document.getElementById('jobs'); if (!box) return;
    api('/printer/commandes').then(function(r){
      box = document.getElementById('jobs'); if (!box) return;
      if (r.status !== 200){ box.innerHTML = '<div class="msg err">Accès refusé.</div>'; return; }
      // La base de calcul est rappelée SOUS les montants, pas dans une page d'aide : c'est
      // là que la question se pose. Le libellé vient du serveur (tarifs.js), donc changer
      // la machine de référence ne laisse pas un texte périmé derrière.
      var ref = document.getElementById('jobsRef');
      if (ref && r.d.reference_label){
        ref.innerHTML = '<details style="margin-top:.9rem;font-size:.78rem;color:var(--muted)">' +
          '<summary style="cursor:pointer">Comment ces montants sont calculés</summary>' +
          '<div style="margin-top:.5rem;line-height:1.6">Base de calcul : <b>'+esc(r.d.reference_label)+'</b>. ' +
          'Le temps retenu est celui de ce profil, identique pour tous les partenaires, quelle que soit votre machine : ' +
          'c\\'est un <b>étalon</b>, pas une prévision du temps que prendra la vôtre. ' +
          'L\\'enveloppe retenue est celle d\\'une machine réelle, plus grande que le plateau de la machine de référence, ' +
          'afin que les rares grandes pièces aient aussi une base de calcul — à profil constant, la taille du plateau ' +
          'n\\'entre pas dans l\\'estimation d\\'une pièce unique. Cela ne dit rien de la compatibilité : celle-ci se ' +
          'vérifie sur votre parc.</div></details>';
      }
      var jobs = r.d.jobs || [];
      var skew = (Date.parse(r.d.now) || Date.now()) - Date.now();  // ancre le compte à rebours sur l'heure serveur
      if (!jobs.length){ box.innerHTML = '<p class="muted" style="margin:0">Aucune commande dans votre zone pour le moment. On vous préviendra par e-mail dès qu\\'une commande tombe.</p>'; return; }
      box.innerHTML = '<div class="grid">' + jobs.map(jobCard).join('') + '</div>';
      jobs.forEach(function(j){
        var clk = document.getElementById('clk-' + cssId(j.id));
        var deadline = Date.parse(j.offer_expires_at);
        if (clk && deadline){
          jobTimers.push(startClock(clk, deadline, skew, function(){
            var b = document.getElementById('rsv-' + cssId(j.id));
            if (b){ b.disabled = true; b.textContent = 'Offre expirée'; }
          }));
        }
        var btn = document.getElementById('rsv-' + cssId(j.id));
        if (btn && !j.mine) btn.addEventListener('click', function(){ doReservePrint(j); });
        var rel = document.getElementById('rel-' + cssId(j.id));
        if (rel && j.mine) rel.addEventListener('click', function(){ doReleasePrint(j); });
        if (j.mine){
          var root = document.getElementById('job-' + cssId(j.id));
          if (root) [].forEach.call(root.querySelectorAll('.slide[data-step]'), function(sl){
            bindSlide(sl, (function(step){ return function(){ doAdvance(j, step); }; })(sl.getAttribute('data-step')));
          });
        }
      });
    }).catch(function(){ var b2 = document.getElementById('jobs'); if (b2) b2.innerHTML = '<div class="msg err">Chargement impossible.</div>'; });
  }

  function jobMeta(j){
    var zone = [j.postal_code, j.ville].filter(Boolean).map(esc).join(' ');
    return [j.material || '—', j.print_time || '—', j.weight || '—'].map(esc).join(' · ') + (zone ? ' · ' + zone : '');
  }
  function jobCard(j){ return j.mine ? mineCard(j) : openCard(j); }

  // Commande disponible : montant + secteur + horloge + bouton Réserver.
  function openCard(j){
    var secteur = j.same_dept ? ' <span class="badge mine">Votre secteur</span>' : '';
    var test = j.is_test ? ' <span class="badge taken">test</span>' : '';
    return '<div class="piece jobc"><div class="ph">🖨</div><div class="info">' +
      '<div class="nom">'+esc(j.product_name)+test+secteur+'</div>' +
      '<div class="meta">'+jobMeta(j)+'</div>' +
      '<div class="stats"><b style="color:var(--ink)">'+eurosFront(j.montant_cents)+'</b> — rémunération estimée</div>' +
      '<div class="clockrow"><span class="muted" style="font-size:.72rem">Offre valable encore</span><span id="clk-'+cssId(j.id)+'">'+flipMarkup()+'</span></div>' +
      '</div><button class="btn" id="rsv-'+cssId(j.id)+'">Réserver l\\'impression</button></div>';
  }

  // Ma commande : badge d'état + suivi de production (3 slides séquentiels). Libérer
  // possible seulement tant que l'impression n'est pas lancée.
  function mineCard(j){
    var started = !!j.started_at, succeeded = !!j.succeeded_at, shipped = !!j.shipped_at;
    var badge = shipped ? '<span class="badge mine">Expédiée ✓</span>'
      : started ? '<span class="badge mine">En production</span>'
      : '<span class="badge mine">Réservée par vous</span>';
    var libe = (j.status === 'reserved' && !started)
      ? '<div style="margin-top:.5rem"><button class="btn secondary" id="rel-'+cssId(j.id)+'" style="font-size:.76rem;padding:.35rem .8rem">Libérer ma réservation</button></div>' : '';
    var slides =
      slideStep(j.id, 'start',   'Lancer l\\'impression',    'Impression lancée',  started ? 'done' : 'active') +
      slideStep(j.id, 'success', 'Impression réussie',       'Impression réussie', succeeded ? 'done' : (started ? 'active' : 'pending')) +
      slideStep(j.id, 'ship',    'Pièce expédiée',           'Pièce expédiée',     shipped ? 'done' : (succeeded ? 'active' : 'pending'));
    return '<div class="piece jobc minejob" id="job-'+cssId(j.id)+'"><div class="ph">🖨</div><div class="info">' +
      '<div class="nom">'+esc(j.product_name)+' '+badge+'</div>' +
      '<div class="meta">'+jobMeta(j)+'</div>' +
      '<div class="stats"><b style="color:var(--ink)">'+eurosFront(j.montant_cents)+'</b> — rémunération estimée</div>' +
      '<div class="prod">'+slides+'</div>' + libe +
      '</div></div>';
  }

  // Un slide : done (validé, statique) / active (glissable) / pending (grisé, précédent non fait).
  function slideStep(jid, step, labelActive, labelDone, state){
    if (state === 'done') return '<div class="slide done"><span class="lbl">✓ '+labelDone+'</span></div>';
    if (state === 'pending') return '<div class="slide pending"><span class="lbl">'+labelActive+'</span></div>';
    return '<div class="slide" data-step="'+step+'"><div class="fill"></div>' +
      '<span class="lbl">'+labelActive+' — glissez →</span><div class="thumb">›</div></div>';
  }

  // Slide-to-confirm : glisser le curseur jusqu'au bout valide l'étape (action délibérée,
  // pas de clic accidentel). Pointer events = souris + tactile unifiés.
  function bindSlide(el, onDone){
    var thumb = el.querySelector('.thumb'), fill = el.querySelector('.fill');
    var x = 0, startX = 0, max = 0, dragging = false;
    thumb.addEventListener('pointerdown', function(e){
      max = el.clientWidth - thumb.offsetWidth - 6; dragging = true; startX = e.clientX - x;
      thumb.setPointerCapture(e.pointerId); e.preventDefault();
    });
    thumb.addEventListener('pointermove', function(e){
      if (!dragging) return;
      x = Math.max(0, Math.min(max, e.clientX - startX));
      thumb.style.transform = 'translateX('+x+'px)'; fill.style.width = (37 + x) + 'px';
    });
    function end(){
      if (!dragging) return; dragging = false;
      if (x >= max * 0.88){ thumb.style.transform = 'translateX('+max+'px)'; fill.style.width = '100%'; el.classList.add('done'); onDone(); }
      else { x = 0; thumb.style.transform = ''; fill.style.width = '37px'; }
    }
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);
  }

  function doAdvance(j, step){
    api('/printer/job/step', { method:'POST', body: JSON.stringify({ job_id: j.id, step: step }) })
      .then(function(){ loadPrinterJobs(); })
      .catch(function(){ loadPrinterJobs(); });
  }

  function doReservePrint(j){
    var btn = document.getElementById('rsv-' + cssId(j.id));
    if (btn){ btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
    api('/printer/reservation', { method:'POST', body: JSON.stringify({ job_id: j.id }) })
      .then(function(){ loadPrinterJobs(); })    // recharge l'état réel (réservée / prise / expirée)
      .catch(function(){ loadPrinterJobs(); });
  }

  function doReleasePrint(j){
    if (!window.confirm('Libérer cette réservation ? La commande repartira aux autres printers.')) return;
    var btn = document.getElementById('rel-' + cssId(j.id));
    if (btn){ btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
    api('/printer/reservation/release', { method:'POST', body: JSON.stringify({ job_id: j.id }) })
      .then(function(){ loadPrinterJobs(); })
      .catch(function(){ loadPrinterJobs(); });
  }

  function seedTestJob(){
    var b = document.getElementById('seedBtn'); if (!b) return;
    b.disabled = true; b.innerHTML = '<span class="spin"></span> Création…';
    api('/printer/seed-test', { method:'POST', body:'{}' }).then(function(){
      b.disabled = false; b.textContent = '＋ Commande de test'; loadPrinterJobs();
    }).catch(function(){ b.disabled = false; b.textContent = '＋ Commande de test'; });
  }

  // Horloge à bascule HH:MM:SS. Le compte à rebours est ancré sur l'heure SERVEUR (skew) ;
  // le serveur revérifie l'expiration à la réservation. flip-in = bascule à chaque changement.
  // Un chiffre = 4 couches : upper/lower statiques (chiffre au repos) + fr (moitié haute
  // qui tombe) + bk (moitié basse qui monte). Chaque couche montre le chiffre PLEIN, clippé.
  function digitCell(){
    return '<span class="digit" data-d="0">' +
      '<span class="half upper"><span class="d">0</span></span>' +
      '<span class="half lower"><span class="d">0</span></span>' +
      '<span class="half fr"><span class="d">0</span></span>' +
      '<span class="half bk"><span class="d">0</span></span>' +
      '</span>';
  }
  function flipMarkup(){
    var g = digitCell() + digitCell();
    return '<span class="flip">'+g+'<span class="sep">:</span>'+g+'<span class="sep">:</span>'+g+'</span>';
  }
  function pad2(n){ return (n < 10 ? '0' : '') + n; }

  // Bascule un chiffre. La moitié basse ne bouge pas ; fr (ancien, moitié haute) tombe et
  // révèle upper (nouveau), puis bk (nouveau, moitié basse) descend sur lower.
  function setDigit(cell, val, animate){
    var cur = cell.getAttribute('data-d');
    if (cur === val) return;
    var upper = cell.querySelector('.upper .d'), lower = cell.querySelector('.lower .d');
    var fr = cell.querySelector('.fr .d'), bk = cell.querySelector('.bk .d');
    cell.setAttribute('data-d', val);
    if (!animate){ upper.textContent = val; lower.textContent = val; fr.textContent = val; bk.textContent = val; return; }
    fr.textContent = cur;      // moitié haute qui tombe = ANCIEN
    upper.textContent = val;   // révélé une fois fr tombée = NOUVEAU
    lower.textContent = cur;   // bas ANCIEN visible tant que bk n'est pas descendue
    bk.textContent = val;      // moitié basse qui monte = NOUVEAU
    cell.classList.remove('flip'); void cell.offsetWidth; cell.classList.add('flip');
    clearTimeout(cell._t);
    cell._t = setTimeout(function(){ lower.textContent = val; fr.textContent = val; cell.classList.remove('flip'); }, 620);
  }

  function startClock(mount, deadlineMs, skewMs, onExpire){
    var flip = mount.querySelector('.flip');
    var cells = flip ? flip.querySelectorAll('.digit') : [];
    var first = true;
    var timer = null;
    function tick(){
      if (!document.body.contains(mount)){ clearInterval(timer); return; }   // écran quitté -> stop
      var now = Date.now() + skewMs;
      var rem = Math.max(0, Math.floor((deadlineMs - now) / 1000));
      var d = (pad2(Math.floor(rem/3600)) + pad2(Math.floor((rem%3600)/60)) + pad2(rem%60)).split('');
      for (var i = 0; i < 6; i++) setDigit(cells[i], d[i], !first);
      first = false;
      if (rem <= 0){ flip.classList.add('exp'); clearInterval(timer); if (onExpire) onExpire(); }
    }
    tick(); timer = setInterval(tick, 1000);
    return function(){ clearInterval(timer); };
  }
  function savePrinterProfileFront(){
    var btn = document.getElementById('epSave'), msg = document.getElementById('ppMsg');
    btn.disabled=true; btn.innerHTML='<span class="spin"></span> Enregistrement…';
    api('/printer/profile', { method:'POST', body: JSON.stringify({
      machines: readMachineList(document.getElementById('epMachines')), materials: chipValues('epMats'),
      postal_code: document.getElementById('epcp').value.trim(), ville: document.getElementById('epville').value.trim(),
      available: document.getElementById('epavail').checked
    }) }).then(function(r){
      btn.disabled=false; btn.textContent='Enregistrer';
      msg.innerHTML = r.status===200 ? '<div class="msg ok">Parc enregistré.</div>' : '<div class="msg err">Enregistrement impossible.</div>';
    }).catch(function(){ btn.disabled=false; btn.textContent='Enregistrer'; msg.innerHTML='<div class="msg err">Enregistrement impossible.</div>'; });
  }

  function screenHotlist(){
    app.innerHTML = '';
    app.appendChild(backLink(screenHome, 'Retour à l\\'espace partenaire'));
    app.insertAdjacentHTML('beforeend', '<h1 style="margin-top:.5rem">Hot List</h1>' +
      '<p class="sub">Les pièces les plus demandées à modéliser. Réservez-en une pour la travailler : l\\'option est <b>exclusive</b>. ' +
      'Envoyez vos photos, et dès notre feu vert vous avez <b>72 h</b> pour déposer votre fichier.</p>' +
      '<p style="margin:-.4rem 0 1rem"><a href="#" id="toMine" style="font-size:.85rem;color:var(--earth)">Voir mes réservations en cours →</a></p>' +
      '<div id="list"><p class="muted">Chargement de la liste…</p></div>');
    document.getElementById('toMine').addEventListener('click', function(e){ e.preventDefault(); screenMine(); });
    api('/modelisateur/hotlist').then(function(r){
      if (r.status !== 200){ document.getElementById('list').innerHTML = '<div class="msg err">Accès refusé.</div>'; return; }
      var pieces = r.d.pieces || [];
      if (!pieces.length){ document.getElementById('list').innerHTML = '<p class="muted">Aucune pièce en attente de modélisation pour le moment.</p>'; return; }
      document.getElementById('list').innerHTML = '<div class="grid">' + pieces.map(pieceCard).join('') + '</div>';
      pieces.forEach(function(p){
        var el = document.getElementById('act-' + cssId(p.id));
        if (!el) return;
        // Réservée par moi : l'action dépend de l'étape. Sans photos -> les envoyer ;
        // au-delà -> le suivi, qui porte le délai et le dépôt.
        if (p.reserved_by_me) el.addEventListener('click', function(){ p.etape === 'pending-review' ? screenReserve(p) : screenMine(); });
        else if (!p.reserved) el.addEventListener('click', function(){ doReserve(p); });
      });
    });
  }

  // ---- Suivi : mes réservations, leur délai, le dépôt --------------------------
  // Le compte à rebours est ancré sur l'heure SERVEUR (champ "now") : une horloge de
  // poste mal réglée ne doit pas faire croire à un délai qu'on n'a pas. Format en
  // jours/heures et non HH:MM:SS car une prolongation porte l'échéance à 144 h.
  function humanLeft(ms){
    if (ms <= 0) return 'délai écoulé';
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return d + ' j ' + (h % 24) + ' h';
    if (h >= 1) return h + ' h ' + (m % 60) + ' min';
    return m + ' min';
  }
  function startTextClock(el, deadlineMs, skewMs, onExpire){
    var fired = false;
    function tick(){
      if (!document.body.contains(el)) { clearInterval(t); return; }
      var left = deadlineMs - (Date.now() + skewMs);
      el.textContent = humanLeft(left);
      if (left <= 0 && !fired){ fired = true; clearInterval(t); if (onExpire) onExpire(); }
    }
    var t = setInterval(tick, 30000);   // le libellé est en minutes : la seconde n'apporte rien
    tick();
    return function(){ clearInterval(t); };
  }

  function screenMine(){
    app.innerHTML = '';
    app.appendChild(backLink(screenHotlist, 'Retour à la Hot List'));
    app.insertAdjacentHTML('beforeend', '<h1 style="margin-top:.5rem">Mes réservations</h1>' +
      '<p class="sub">L\\'état de chaque pièce que vous avez réservée, et le temps qu\\'il vous reste.</p>' +
      '<div id="mine"><p class="muted">Chargement…</p></div>');
    api('/modelisateur/reservations').then(function(r){
      var box = document.getElementById('mine');
      if (r.status !== 200){ box.innerHTML = '<div class="msg err">Accès refusé.</div>'; return; }
      var list = r.d.reservations || [];
      var skew = Date.parse(r.d.now) - Date.now();
      if (!list.length){
        box.innerHTML = '<p class="muted">Aucune réservation en cours. Réservez une pièce dans la Hot List pour commencer.</p>';
        return;
      }
      box.innerHTML = list.map(function(x){ return resvCard(x, r.d.depot); }).join('');
      list.forEach(function(x){
        var clock = document.getElementById('clk-' + x.id);
        if (clock && x.expires_at) startTextClock(clock, Date.parse(x.expires_at), skew, function(){ screenMine(); });
        var dep = document.getElementById('dep-' + x.id);
        if (dep) dep.addEventListener('click', function(){ screenDeposit(x, r.d.depot); });
        var ext = document.getElementById('ext-' + x.id);
        if (ext) ext.addEventListener('click', function(){ doExtend(x, ext); });
        var pho = document.getElementById('pho-' + x.id);
        if (pho) pho.addEventListener('click', function(){ screenReserve({ id: x.piece_id, nom: x.nom }); });
      });
    });
  }

  function resvCard(x, depot){
    var etat, aide, actions = '';
    if (x.status === 'pending-review'){
      etat = 'En attente de notre feu vert';
      aide = 'Vos photos sont arrivées. Dès que nous validons, votre délai de 72 h démarre — pas avant.';
      actions = '<button class="btn secondary" id="pho-'+x.id+'">Renvoyer mes photos</button>';
    } else if (x.status === 'active'){
      etat = x.submission ? 'Correction demandée' : 'À vous — 72 h pour déposer';
      aide = x.submission && x.submission.review_note
        ? 'Reprenez votre fichier : « ' + esc(x.submission.review_note) + ' »'
        : 'Déposez le fichier source de votre logiciel et son export STEP.';
      actions = '<button class="btn" id="dep-'+x.id+'">Déposer mon fichier</button>' +
        (x.can_extend ? '<button class="btn secondary" id="ext-'+x.id+'" title="Une seule fois, non renouvelable">Prolonger de 72 h</button>' : '');
    } else if (x.status === 'submitted'){
      etat = 'Fichier déposé — en examen';
      aide = 'Nous examinons votre fichier' + (x.submission ? ' (version ' + x.submission.version + ')' : '') + '. Vous serez prévenu de la décision.';
    } else if (x.status === 'suspended'){
      etat = 'Réservation suspendue';
      aide = 'Un administrateur vérifie vos photos. Votre option est gelée le temps de ce contrôle.';
    } else {
      etat = x.status;
      aide = '';
    }
    var ext = x.extended_at ? '<div class="muted" style="font-size:.74rem;margin-top:.3rem">Prolongation utilisée — elle n\\'est pas renouvelable.</div>' : '';
    // L'échéance change de propriétaire selon l'étape : c'est SON délai quand il
    // travaille, le NÔTRE quand on examine. Le même libellé pour les deux ferait
    // croire à une pression qui n'existe pas.
    var libelle = x.status === 'active' ? 'Il vous reste'
      : x.status === 'pending-review' ? 'Notre réponse sous'
      : x.status === 'submitted' ? 'Réponse au plus tard sous' : 'Échéance';
    return '<div class="card" style="margin-bottom:.9rem">' +
      '<div style="display:flex;justify-content:space-between;gap:.8rem;flex-wrap:wrap;align-items:baseline">' +
        '<div><strong>'+esc(x.nom)+'</strong><div class="muted" style="font-size:.8rem">'+esc(etat)+'</div></div>' +
        (x.expires_at ? '<div style="text-align:right"><div class="muted" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.05em">'+libelle+'</div>' +
          '<div id="clk-'+x.id+'" style="font-weight:600">…</div></div>' : '') +
      '</div>' +
      (aide ? '<p class="muted" style="font-size:.84rem;margin:.6rem 0 0">'+aide+'</p>' : '') + ext +
      (actions ? '<div style="display:flex;gap:.5rem;margin-top:.9rem;flex-wrap:wrap">'+actions+'</div>' : '') +
      '</div>';
  }

  function doExtend(x, btn){
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    api('/modelisateur/reservation/extend', { method:'POST', body: JSON.stringify({ piece_id: x.piece_id }) })
      .then(function(){ screenMine(); })
      .catch(function(){ screenMine(); });
  }

  function cssId(id){ return btoa(unescape(encodeURIComponent(id))).replace(/[^a-zA-Z0-9]/g,''); }
  function pieceCard(p){
    var meta = [p.appareil, p.marque].filter(Boolean).map(esc).join(' · ');
    var boost = p.boost > 0 ? ' · <span class="boost">avance +'+p.boost+' €</span>' : '';
    var right;
    // Le libellé annonce ce que fait le bouton à CETTE étape : envoyer les photos
    // quand elles manquent encore, suivre le délai et déposer une fois lancé.
    if (p.reserved_by_me) right = '<button class="btn secondary" id="act-'+cssId(p.id)+'">' +
      (p.etape === 'pending-review' ? 'Vos photos' : 'Votre dossier') + '</button>';
    else if (p.deja_deposee) right = '<span class="badge taken">Fichier déjà déposé</span>';
    else if (p.reserved) right = '<span class="badge taken">Réservée</span>';
    else right = '<button class="btn" id="act-'+cssId(p.id)+'">Réserver</button>';
    return '<div class="piece"><div class="ph">🔧</div><div class="info"><div class="nom">'+esc(p.nom)+'</div><div class="meta">'+meta+'</div>'+
      '<div class="stats">Demande '+(p.demande||0)+boost+'</div></div>'+right+'</div>';
  }

  function doReserve(p){
    var el = document.getElementById('act-' + cssId(p.id));
    el.disabled = true; el.innerHTML = '<span class="spin"></span>';
    api('/modelisateur/reservation', { method:'POST', body: JSON.stringify({ piece_id: p.id }) }).then(function(r){
      if (r.status === 201) return screenReserve(p);
      screenHotlist(); // conflit (409) ou erreur -> on recharge l'état réel
    }).catch(function(){ screenHotlist(); });
  }

  // Écran réservation : trois photos (redimensionnées), envoi + validation IA.
  // La 3e — la pièce seule — est FACULTATIVE : une pièce cassée peut être inaccessible
  // sans démonter l'appareil, l'exiger bloquerait des réservations légitimes.
  var photos = { plate:null, object:null, part:null };
  function screenReserve(p){
    photos = { plate:null, object:null, part:null };
    app.innerHTML =
      '<a href="#" id="back" class="muted" style="text-decoration:none;font-size:.85rem">← Retour à la Hot List</a>' +
      '<h1 style="margin-top:.5rem">Réservation — '+esc(p.nom)+'</h1>' +
      '<p class="sub">Envoyez vos photos pour ouvrir la réservation : la <b>plaque signalétique</b> de l\\'appareil et <b>l\\'appareil donneur</b>. ' +
      'Ajoutez <b>la pièce seule</b> si vous l\\'avez en main. Une vérification automatique contrôle leur cohérence, ' +
      'puis nous validons — c\\'est <b>notre feu vert</b> qui démarre vos 72 h, pas cet envoi.</p>' +
      '<div id="rMsg"></div>' +
      '<div class="three">' +
        dropZone('plate', 'Plaque signalétique') +
        dropZone('object', 'Appareil donneur') +
        dropZone('part', 'La pièce <span class="opt">— si disponible</span>') +
      '</div>' +
      '<div style="margin-top:1.4rem" class="neon" id="neon"><button class="btn" id="sendBtn" disabled>Envoyer les photos</button></div>';
    document.getElementById('back').addEventListener('click', function(e){ e.preventDefault(); screenHotlist(); });
    ['plate','object','part'].forEach(function(k){ bindDrop(k); });
    document.getElementById('sendBtn').addEventListener('click', function(){ sendPhotos(p); });
  }
  function dropZone(k, label){
    return '<div class="field"><label>'+label+'</label>' +
      '<div class="drop" id="drop-'+k+'"><span class="muted">📷 Cliquez pour choisir une photo</span>' +
      '<input type="file" accept="image/*" id="file-'+k+'" hidden></div></div>';
  }
  function bindDrop(k){
    var drop = document.getElementById('drop-'+k), file = document.getElementById('file-'+k);
    drop.addEventListener('click', function(){ file.click(); });
    file.addEventListener('change', function(){
      var f = file.files && file.files[0]; if (!f) return;
      var img = new Image();
      img.onload = function(){
        var max=1024, w=img.width, h=img.height;
        if (w>max||h>max){ var s=Math.min(max/w,max/h); w=Math.round(w*s); h=Math.round(h*s); }
        var cv=document.createElement('canvas'); cv.width=w; cv.height=h; cv.getContext('2d').drawImage(img,0,0,w,h);
        photos[k] = cv.toDataURL('image/jpeg',0.82); URL.revokeObjectURL(img.src);
        drop.innerHTML = '<img src="'+photos[k]+'" alt="'+k+'"><div class="muted" style="font-size:.75rem;margin-top:.3rem">Changer</div>';
        document.getElementById('sendBtn').disabled = !(photos.plate && photos.object);
      };
      img.onerror = function(){ document.getElementById('rMsg').innerHTML = '<div class="msg err">Image illisible, essayez-en une autre.</div>'; };
      img.src = URL.createObjectURL(f);
    });
  }
  function sendPhotos(p){
    var btn = document.getElementById('sendBtn'), neon = document.getElementById('neon'), msg = document.getElementById('rMsg');
    if (!photos.plate || !photos.object) return;
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Envoi et vérification…'; neon.classList.add('active');
    var payload = { piece_id: p.id, plate: photos.plate, object: photos.object };
    if (photos.part) payload.part = photos.part;
    api('/modelisateur/reservation/photos', { method:'POST', body: JSON.stringify(payload) })
      .then(function(r){
        neon.classList.remove('active');
        if (r.status === 200){
          var v = r.d.ai_check;
          var note = v === 'suspect'
            ? '<div class="msg err">Photos reçues, mais notre vérification les trouve douteuses : un administrateur va les regarder.</div>'
            : '<div class="msg ok">Photos reçues '+(v==='ok'?'et cohérentes':'')+'. La pièce vous est réservée.</div>';
          app.innerHTML = '<h1>Réservation ouverte</h1><p class="sub">'+esc(p.nom)+'</p>'+note+
            '<p class="muted" style="font-size:.86rem">Prochaine étape : <b>notre validation</b>. Dès qu\\'elle est donnée, vous disposez de <b>72 h</b> ' +
            'pour déposer votre fichier — vous verrez le compte à rebours dans « Mes réservations ». Rien ne court contre vous d\\'ici là.</p>' +
            '<div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn" id="toMine2">Voir mes réservations</button>' +
            '<button class="btn secondary" id="toList">Retour à la Hot List</button></div>';
          document.getElementById('toMine2').addEventListener('click', screenMine);
          document.getElementById('toList').addEventListener('click', screenHotlist);
        } else {
          btn.disabled=false; btn.textContent='Envoyer les photos';
          var e = r.d.error;
          msg.innerHTML = '<div class="msg err">'+(
            e==='photos_invalides' ? 'Photos invalides.' :
            e==='photo_piece_invalide' ? 'La photo de la pièce est illisible — retirez-la ou reprenez-la.' :
            e==='aucune_reservation' ? 'Réservation introuvable ou expirée.' : 'Envoi impossible.')+'</div>';
        }
      })
      .catch(function(){ neon.classList.remove('active'); btn.disabled=false; btn.textContent='Envoyer les photos'; msg.innerHTML='<div class="msg err">Connexion interrompue.</div>'; });
  }

  // ---- Dépôt du fichier -------------------------------------------------------
  // DEUX fichiers, et jamais de maillage : le source natif (l'œuvre) et le STEP
  // (ce que nous convertissons). L'acte de cession est coché ICI, pour CE fichier :
  // une case avalée à l'inscription ne vaudrait rien juridiquement.
  var deposit = { native:null, step:null };
  function screenDeposit(x, depot){
    deposit = { native:null, step:null };
    var natifs = (depot.natifs_connus || []).slice(0, 6).join(', ');
    var refus = (depot.mesh_refuses || []).join(', ');
    app.innerHTML =
      '<a href="#" id="back" class="muted" style="text-decoration:none;font-size:.85rem">← Retour à mes réservations</a>' +
      '<h1 style="margin-top:.5rem">Déposer — '+esc(x.nom)+'</h1>' +
      '<p class="sub">Deux fichiers sont attendus. Le <b>fichier de votre logiciel</b> ('+esc(natifs)+'…) : c\\'est votre œuvre, ' +
      'nous l\\'archivons et ne le distribuons jamais. Et son <b>export STEP</b> — géométrie exacte, c\\'est lui que nous convertissons.<br>' +
      'Les maillages ('+esc(refus)+') sont refusés, y compris le 3MF : ils figeraient la finesse choisie par votre exportateur, ' +
      'alors que nous maillons nous-mêmes en <b>très haute résolution</b> pour ne rien perdre de vos cotes. ' +
      'Exportez un <b>solide</b>, en <b>millimètres</b>.</p>' +
      (x.submission && x.submission.review_note
        ? '<div class="msg err" style="margin-bottom:1rem"><b>Correction demandée :</b> '+esc(x.submission.review_note)+'</div>' : '') +
      '<div id="dMsg"></div>' +
      '<div class="two">' + fileZone('native', 'Fichier source de votre logiciel') + fileZone('step', 'Export STEP (.step / .stp)') + '</div>' +
      '<div class="card" style="margin-top:1.2rem">' +
        '<label style="display:flex;gap:.6rem;align-items:flex-start;font-size:.86rem;cursor:pointer">' +
          '<input type="checkbox" id="cess" style="margin-top:.25rem">' +
          '<span>Je déclare être l\\'auteur de ce fichier et <b>céder mes droits à Hub4Fix sur ce fichier</b>, ' +
          'aux conditions des CGV modélisateurs (art. 2). Cette cession est <b>horodatée maintenant</b> et porte sur ce dépôt précis. ' +
          'Elle est <b>résolue de plein droit</b> si le fichier est refusé, ou non validé sous 60 jours.</span>' +
        '</label>' +
        '<div id="prog" class="muted" style="font-size:.8rem;margin-top:.8rem"></div>' +
        '<div style="margin-top:.9rem"><button class="btn" id="sendFile" disabled>Déposer le fichier</button></div>' +
      '</div>';
    document.getElementById('back').addEventListener('click', function(e){ e.preventDefault(); screenMine(); });
    ['native','step'].forEach(function(k){ bindFile(k, depot); });
    document.getElementById('cess').addEventListener('change', refreshDepositBtn);
    document.getElementById('sendFile').addEventListener('click', function(){ sendDeposit(x, depot); });
  }
  function fileZone(k, label){
    return '<div class="field"><label>'+esc(label)+'</label>' +
      '<div class="drop" id="fz-'+k+'"><span class="muted">📁 Cliquez pour choisir un fichier</span>' +
      '<input type="file" id="ff-'+k+'" hidden></div></div>';
  }
  function refreshDepositBtn(){
    var ok = deposit.native && deposit.step && document.getElementById('cess').checked;
    document.getElementById('sendFile').disabled = !ok;
  }
  function bindFile(k, depot){
    var zone = document.getElementById('fz-'+k), input = document.getElementById('ff-'+k);
    zone.addEventListener('click', function(){ input.click(); });
    input.addEventListener('change', function(){
      var f = input.files && input.files[0];
      var msg = document.getElementById('dMsg');
      if (!f) return;
      // Contrôles côté écran : ils évitent un aller-retour de 25 Mo pour rien. Le
      // serveur refait les mêmes, c'est lui qui décide.
      var ext = (f.name.match(/\\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
      var maxOctets = (depot.max_mo || 25) * 1048576;
      if (f.size > maxOctets){
        msg.innerHTML = '<div class="msg err">'+esc(f.name)+' pèse '+Math.round(f.size/1048576)+' Mo : le maximum est '+(depot.max_mo||25)+' Mo par fichier.</div>';
        input.value = ''; return;
      }
      if (k === 'step' && (depot.step_exts || []).indexOf(ext) < 0){
        msg.innerHTML = '<div class="msg err">Le second fichier doit être un STEP ('+(depot.step_exts||[]).join(' ou ')+').</div>';
        input.value = ''; return;
      }
      if (k === 'native' && (depot.mesh_refuses || []).indexOf(ext) >= 0){
        msg.innerHTML = '<div class="msg err">'+esc(ext)+' est un maillage, pas un fichier source. Déposez le fichier de votre logiciel de conception.</div>';
        input.value = ''; return;
      }
      msg.innerHTML = '';
      deposit[k] = f;
      zone.innerHTML = '<div style="font-weight:600;font-size:.86rem">'+esc(f.name)+'</div>' +
        '<div class="muted" style="font-size:.75rem;margin-top:.2rem">'+(f.size>1048576?(f.size/1048576).toFixed(1)+' Mo':Math.round(f.size/1024)+' Ko')+' · changer</div>';
      refreshDepositBtn();
    });
  }
  // XHR et non fetch : c'est le seul moyen d'avoir la progression de l'envoi, et sur
  // 25 Mo un bouton qui tourne sans rien dire donne l'impression d'un blocage.
  function sendDeposit(x, depot){
    var btn = document.getElementById('sendFile'), prog = document.getElementById('prog'), msg = document.getElementById('dMsg');
    if (!deposit.native || !deposit.step) return;
    var fd = new FormData();
    fd.append('piece_id', x.piece_id);
    fd.append('cession', 'true');
    fd.append('native', deposit.native, deposit.native.name);
    fd.append('step', deposit.step, deposit.step.name);
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Envoi…';
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API + '/modelisateur/submission', true);
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', function(e){
      if (e.lengthComputable) prog.textContent = 'Envoi : ' + Math.round(e.loaded / e.total * 100) + ' %';
    });
    xhr.addEventListener('load', function(){
      var d = {}; try { d = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status === 201 || (xhr.status === 200 && d.ok)){
        app.innerHTML = '<h1>Fichier déposé</h1><p class="sub">'+esc(x.nom)+'</p>' +
          '<div class="msg ok">Votre fichier est arrivé' + (d.version > 1 ? ' (version '+d.version+')' : '') + '. ' +
          'La cession a été enregistrée le '+esc(String(d.cession_at||'').slice(0,10))+'.</div>' +
          '<p class="muted" style="font-size:.86rem">Nous l\\'examinons, puis nous préparons le fichier d\\'impression. ' +
          'Vous serez prévenu de la décision.</p>' +
          '<button class="btn secondary" id="toMine3">Retour à mes réservations</button>';
        document.getElementById('toMine3').addEventListener('click', screenMine);
        return;
      }
      btn.disabled = false; btn.textContent = 'Déposer le fichier'; prog.textContent = '';
      msg.innerHTML = '<div class="msg err">'+esc(d.message || 'Dépôt impossible.')+'</div>';
    });
    xhr.addEventListener('error', function(){
      btn.disabled = false; btn.textContent = 'Déposer le fichier'; prog.textContent = '';
      msg.innerHTML = '<div class="msg err">Connexion interrompue — le fichier n\\'a pas été déposé.</div>';
    });
    xhr.send(fd);
  }

  load();
})();
</script>
</body>
</html>`;
