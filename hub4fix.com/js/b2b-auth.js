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
 */
(function(){
  var GOOGLE_CLIENT_ID = 'REMPLACER_PAR_VOTRE_CLIENT_ID.apps.googleusercontent.com';

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

  // Connexion Google : pré-remplit le formulaire depuis le profil Google
  window.H4FGoogleSignIn = function(containerId, formId, statusId){
    if(!window.google || !google.accounts || GOOGLE_CLIENT_ID.indexOf('REMPLACER') === 0) return;
    var form = document.getElementById(formId);
    if(!form) return;

    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: function(resp){
        var payload = decodeJwt(resp.credential);
        if(!payload) return;
        fillIfEmpty(form, 'prenom', payload.given_name);
        fillIfEmpty(form, 'nom', payload.family_name);
        var emailEl = form.querySelector('[name="email"]');
        if(emailEl) emailEl.value = payload.email;

        var hidden = form.querySelector('[name="google_id_token"]');
        if(!hidden){
          hidden = document.createElement('input');
          hidden.type = 'hidden';
          hidden.name = 'google_id_token';
          form.appendChild(hidden);
        }
        hidden.value = resp.credential;

        var status = document.getElementById(statusId);
        if(status){
          status.innerHTML = '✓ Connecté via Google — <b>' + payload.email + '</b>';
          status.style.display = 'block';
        }
      }
    });

    google.accounts.id.renderButton(document.getElementById(containerId), {
      theme: 'filled_black', shape: 'pill', text: 'continue_with', size: 'large', locale: 'fr'
    });
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
