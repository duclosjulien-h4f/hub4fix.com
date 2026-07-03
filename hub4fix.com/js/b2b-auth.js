/**
 * Hub4Fix — Connexion Google + géolocalisation pour les formulaires B2B
 * (modelisateur.html, printer.html)
 *
 * Google Sign-In natif (Google Identity Services), indépendant du SSO Zitadel
 * utilisé côté admin/partenaire : ici il ne sert qu'à pré-remplir le
 * formulaire d'inscription (prénom, nom, email), pas à ouvrir une session.
 *
 * *** A CONFIGURER *** : remplacer GOOGLE_CLIENT_ID par le Client ID OAuth
 * créé dans Google Cloud Console > APIs & Services > Identifiants
 * (type "ID client OAuth", application Web, origine autorisée : https://hub4fix.com)
 * Tant que ce n'est pas fait, un sélecteur de compte SIMULÉ prend le relais
 * (mode démo, aucune donnée Google réelle) pour que le canal soit testable.
 */
(function(){
  var GOOGLE_CLIENT_ID = 'REMPLACER_PAR_VOTRE_CLIENT_ID.apps.googleusercontent.com';
  var isConfigured = GOOGLE_CLIENT_ID.indexOf('REMPLACER') !== 0;

  var DEMO_ACCOUNTS = [
    { given_name:'Camille', family_name:'Berthier', email:'camille.berthier.demo@gmail.com' },
    { given_name:'Yanis', family_name:'Kader', email:'yanis.kader.demo@gmail.com' }
  ];

  function decodeJwt(token){
    try{
      var b64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      var json = decodeURIComponent(atob(b64).split('').map(function(c){
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(json);
    }catch(e){ return null; }
  }

  function fillIfEmpty(form, name, value){
    if(!value) return;
    var el = form.querySelector('[name="' + name + '"]');
    if(el && !el.value) el.value = value;
  }

  function applyProfile(form, statusId, payload, simulated){
    fillIfEmpty(form, 'prenom', payload.given_name);
    fillIfEmpty(form, 'nom', payload.family_name);
    var emailEl = form.querySelector('[name="email"]');
    if(emailEl) emailEl.value = payload.email;

    var markerName = simulated ? 'google_signin_demo' : 'google_id_token';
    var hidden = form.querySelector('[name="' + markerName + '"]');
    if(!hidden){
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = markerName;
      form.appendChild(hidden);
    }
    hidden.value = simulated ? payload.email : payload.credential;

    var status = document.getElementById(statusId);
    if(status){
      status.innerHTML = simulated
        ? '✓ Connecté (compte démo simulé) — <b>' + payload.email + '</b> <span style="opacity:.7">— aucune donnée Google réelle utilisée</span>'
        : '✓ Connecté via Google — <b>' + payload.email + '</b>';
      status.style.display = 'block';
    }
  }

  // ---- Sélecteur de compte simulé (mode démo, sans dépendance Google) ----
  var pickerInjected = false;
  function injectPickerStyles(){
    if(pickerInjected) return;
    pickerInjected = true;
    var css = '.gsim-overlay{position:fixed;inset:0;background:rgba(28,26,24,.55);backdrop-filter:blur(3px);z-index:400;display:flex;align-items:center;justify-content:center;padding:1rem}' +
      '.gsim-card{background:#fff;border-radius:12px;width:340px;max-width:100%;box-shadow:0 24px 60px rgba(0,0,0,.28);overflow:hidden;font-family:"Karla",sans-serif}' +
      '.gsim-head{padding:1.6rem 1.6rem 1.1rem;text-align:center;border-bottom:1px solid #ECECEC}' +
      '.gsim-head svg{width:26px;height:26px;margin-bottom:.7rem}' +
      '.gsim-head h3{font-size:1.05rem;font-weight:500;color:#1f1f1f;margin-bottom:.3rem}' +
      '.gsim-head p{font-size:.82rem;color:#5f6368}' +
      '.gsim-list{padding:.5rem}' +
      '.gsim-row{display:flex;align-items:center;gap:.8rem;width:100%;background:none;border:none;padding:.7rem .9rem;border-radius:8px;cursor:pointer;text-align:left;transition:background .15s}' +
      '.gsim-row:hover{background:#f5f5f5}' +
      '.gsim-avatar{width:34px;height:34px;border-radius:50%;background:var(--gold,#B8963E);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.82rem;font-weight:700;flex-shrink:0}' +
      '.gsim-name{font-size:.86rem;color:#1f1f1f;font-weight:500}' +
      '.gsim-email{font-size:.76rem;color:#5f6368}' +
      '.gsim-foot{padding:.9rem 1.4rem 1.2rem;font-size:.68rem;color:#9a9a9a;text-align:center;border-top:1px solid #ECECEC}' +
      '.gsim-cancel{display:block;width:calc(100% - 1.8rem);margin:.2rem .9rem .8rem;padding:.55rem;border:1px solid #dadce0;background:none;border-radius:8px;font-size:.78rem;color:#3c4043;cursor:pointer}';
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  var GOOGLE_G_SVG = '<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.5 0 10.5-2.1 14.3-5.6l-6.6-5.6C29.6 34.7 26.9 36 24 36c-5.3 0-9.7-3.1-11.3-7.4l-6.5 5C9.6 39.7 16.3 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.6 5.6C41.5 36.4 44 30.7 44 24c0-1.3-.1-2.7-.4-3.5z"/></svg>';

  function openPicker(form, statusId){
    injectPickerStyles();
    var overlay = document.createElement('div');
    overlay.className = 'gsim-overlay';
    var rows = DEMO_ACCOUNTS.map(function(a, i){
      var initials = (a.given_name[0] + a.family_name[0]).toUpperCase();
      return '<button type="button" class="gsim-row" data-idx="' + i + '">' +
        '<span class="gsim-avatar">' + initials + '</span>' +
        '<span><span class="gsim-name" style="display:block">' + a.given_name + ' ' + a.family_name + '</span>' +
        '<span class="gsim-email">' + a.email + '</span></span></button>';
    }).join('');
    overlay.innerHTML =
      '<div class="gsim-card">' +
        '<div class="gsim-head">' + GOOGLE_G_SVG + '<h3>Choisir un compte</h3><p>pour continuer vers hub4fix.com</p></div>' +
        '<div class="gsim-list">' + rows + '</div>' +
        '<button type="button" class="gsim-cancel">Annuler</button>' +
        '<div class="gsim-foot">Mode démo — sélecteur simulé, aucune connexion Google réelle.</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function(e){
      if(e.target === overlay || e.target.classList.contains('gsim-cancel')){
        overlay.remove();
        return;
      }
      var row = e.target.closest('.gsim-row');
      if(!row) return;
      var account = DEMO_ACCOUNTS[+row.getAttribute('data-idx')];
      applyProfile(form, statusId, account, true);
      overlay.remove();
    });
  }

  // Connexion Google : pré-remplit le formulaire depuis le profil Google
  // (ou depuis un compte démo simulé tant que GOOGLE_CLIENT_ID n'est pas configuré)
  window.H4FGoogleSignIn = function(containerId, formId, statusId){
    var form = document.getElementById(formId);
    var container = document.getElementById(containerId);
    if(!form || !container) return;

    if(isConfigured && window.google && google.accounts){
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: function(resp){
          var payload = decodeJwt(resp.credential);
          if(!payload) return;
          payload.credential = resp.credential;
          applyProfile(form, statusId, payload, false);
        }
      });
      google.accounts.id.renderButton(container, {
        theme: 'filled_black', shape: 'pill', text: 'continue_with', size: 'large', locale: 'fr'
      });
      return;
    }

    // Fallback simulé : bouton visuellement identique, sélecteur de compte démo
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gsim-btn';
    btn.style.cssText = 'display:flex;align-items:center;gap:.6rem;background:#131314;color:#e3e3e3;border:1px solid #8e918f;border-radius:20px;padding:.6rem 1.3rem;font-family:"Karla",sans-serif;font-size:.85rem;font-weight:500;cursor:pointer;transition:background .2s';
    btn.innerHTML = '<span style="width:18px;height:18px;display:inline-flex">' + GOOGLE_G_SVG + '</span><span>Continuer avec Google</span>';
    btn.addEventListener('mouseenter', function(){ btn.style.background = '#1e1e1f'; });
    btn.addEventListener('mouseleave', function(){ btn.style.background = '#131314'; });
    btn.addEventListener('click', function(){ openPicker(form, statusId); });
    container.appendChild(btn);
  };

  // Géolocalisation navigateur -> code postal / ville (API Base Adresse Nationale, gratuite, sans clé)
  window.H4FGeoloc = function(btnId, formId){
    var btn = document.getElementById(btnId);
    var form = document.getElementById(formId);
    if(!btn || !form) return;

    btn.addEventListener('click', function(){
      var original = btn.textContent;
      if(!navigator.geolocation){
        btn.textContent = 'Géolocalisation indisponible';
        setTimeout(function(){ btn.textContent = original; }, 2500);
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Localisation…';
      navigator.geolocation.getCurrentPosition(function(pos){
        var lat = pos.coords.latitude, lon = pos.coords.longitude;
        fetch('https://api-adresse.data.gouv.fr/reverse/?lon=' + lon + '&lat=' + lat)
          .then(function(r){ return r.json(); })
          .then(function(j){
            var f = j.features && j.features[0];
            btn.disabled = false; btn.textContent = original;
            if(!f) return;
            var p = f.properties;
            var cp = form.querySelector('[name="cp"]'); if(cp) cp.value = p.postcode || cp.value;
            var ville = form.querySelector('[name="ville"]'); if(ville) ville.value = p.city || ville.value;
          })
          .catch(function(){ btn.disabled = false; btn.textContent = original; });
      }, function(){
        btn.disabled = false;
        btn.textContent = 'Position refusée';
        setTimeout(function(){ btn.textContent = original; }, 2500);
      }, { timeout: 8000 });
    });
  };
})();
