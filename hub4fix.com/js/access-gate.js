/**
 * Hub4Fix — verrou de navigation sur les pages de service (hors présentation).
 *
 * IMPORTANT : ceci est un confort d'usage, PAS une vraie protection. Le site
 * est hébergé en statique pur (GitHub Pages) : n'importe qui peut lire le HTML
 * brut en contournant le JavaScript. Une vraie protection demanderait de
 * servir ces pages derrière un Worker (comme l'espace admin/partenaire).
 *
 * Autorise l'accès si le mode démo est actif OU si une session client existe
 * (js/account-menu.js, window.H4FAccount). Sinon, affiche un écran de blocage
 * plein écran (mode démo en un clic, ou connexion via js/client-auth.js).
 *
 * Usage : dans le <head>, avant tout autre contenu :
 *   <script>document.documentElement.style.visibility='hidden'</script>
 *   <script src="js/account-menu.js"></script>  (doit précéder access-gate.js)
 *   <script src="js/access-gate.js"></script>
 */
(function(){
  function allowed(){
    var acc = window.H4FAccount;
    if(!acc) return true; // account-menu.js absent : ne bloque jamais par erreur
    return acc.demoOn() || !!acc.clientSession();
  }

  function reveal(){ document.documentElement.style.visibility = ''; }

  if(allowed()){ reveal(); return; }

  window.H4F_GATE_ACTIVE = true;

  function showGate(){
    reveal();
    var css =
      '#h4f-gate{position:fixed;inset:0;z-index:9999;background:#15130F;display:flex;align-items:center;justify-content:center;padding:1.5rem;font-family:"Karla",sans-serif}' +
      '#h4f-gate .card{max-width:420px;text-align:center;color:#FAF8F5}' +
      '#h4f-gate .eyebrow{font-family:"DM Mono",monospace;font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;color:#B8963E;margin-bottom:1rem}' +
      '#h4f-gate h2{font-family:"Cormorant Garamond",serif;font-weight:500;font-size:2rem;margin-bottom:.8rem}' +
      '#h4f-gate p{font-size:.92rem;color:#C9C3B8;line-height:1.6;margin-bottom:1.8rem}' +
      '#h4f-gate .btn{display:block;width:100%;padding:.9rem;border-radius:8px;font-size:.88rem;font-weight:600;cursor:pointer;margin-bottom:.8rem;border:none;font-family:inherit}' +
      '#h4f-gate .btn-demo{background:#2D8B5E;color:#fff}' +
      '#h4f-gate .btn-login{background:#C8102E;color:#fff}' +
      '#h4f-gate .alt{margin-top:1rem;font-size:.78rem}' +
      '#h4f-gate .alt a{color:#B8963E;text-decoration:underline}';
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);

    var el = document.createElement('div');
    el.id = 'h4f-gate';
    el.innerHTML =
      '<div class="card">' +
        '<div class="eyebrow">Accès réservé</div>' +
        '<h2>Cette page se visite connecté.</h2>' +
        '<p>Explorez en mode démo (aucune donnée réelle) ou connectez-vous en un e-mail — pas de dossier à monter pour un client.</p>' +
        '<button type="button" class="btn btn-demo" id="h4fGateDemo">Activer le mode démo</button>' +
        '<button type="button" class="btn btn-login" id="h4fGateLogin">Se connecter</button>' +
        '<div class="alt">Vous êtes partenaire ? <a href="modelisateur.html">Modélisateur</a> · <a href="printer.html">Printer</a></div>' +
      '</div>';
    document.body.appendChild(el);
    document.documentElement.style.overflow = 'hidden';

    document.getElementById('h4fGateDemo').addEventListener('click', function(){
      window.H4FAccount.setDemo(true);
      window.location.reload();
    });
    document.getElementById('h4fGateLogin').addEventListener('click', function(){
      if(window.H4FZitadel) window.H4FZitadel.login(window.location.href);
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showGate);
  else showGate();
})();
