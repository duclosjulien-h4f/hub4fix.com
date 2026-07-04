/**
 * Hub4Fix — Inscription / connexion CLIENT (B2C), volontairement légère.
 *
 * Contrairement au parcours partenaire (CGV à lire intégralement, portfolio,
 * machines, statut pro...), le client n'a besoin que d'un email pour réparer
 * une pièce : un champ, une case à cocher, un bouton Google en raccourci.
 *
 * Alimente le même pipeline que les leads modélisateur/printer
 * (worker/collect-email.js, type "client"). La session "connecté" est gérée
 * par js/account-menu.js (window.H4FAccount) — ici on ne fait que collecter
 * le formulaire et déclencher la mise à jour du menu.
 */
(function(){
  var WORKER_URL = 'https://h4f-collect.duclosjulien.workers.dev';
  var ADMIN_ORIGIN = 'https://h4f-admin.duclosjulien.workers.dev';

  // L'email tapé est-il un email admin ? Ne renvoie qu'un booléen (worker/admin.js
  // /api/is-admin), jamais la liste des emails admin — si ça échoue, on ne bloque
  // jamais le parcours client normal.
  function checkAdmin(email){
    if(!email || email.indexOf('@') < 0) return Promise.resolve(false);
    return fetch(ADMIN_ORIGIN + '/api/is-admin?email=' + encodeURIComponent(email))
      .then(function(r){ return r.json(); })
      .then(function(j){ return !!(j && j.isAdmin); })
      .catch(function(){ return false; });
  }

  var DEMO_ACCOUNTS = [
    { given_name:'Camille', email:'camille.demo@gmail.com' },
    { given_name:'Yanis', email:'yanis.demo@gmail.com' }
  ];
  var GOOGLE_G_SVG = '<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.5 0 10.5-2.1 14.3-5.6l-6.6-5.6C29.6 34.7 26.9 36 24 36c-5.3 0-9.7-3.1-11.3-7.4l-6.5 5C9.6 39.7 16.3 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.6 5.6C41.5 36.4 44 30.7 44 24c0-1.3-.1-2.7-.4-3.5z"/></svg>';

  var injected = false;
  function injectStyles(){
    if(injected) return; injected = true;
    var css =
      '.h4fca-overlay{position:fixed;inset:0;background:rgba(28,26,24,.5);backdrop-filter:blur(3px);z-index:500;display:flex;align-items:center;justify-content:center;padding:1rem;font-family:"Karla",sans-serif}' +
      '.h4fca-card{position:relative;background:#FAF8F5;border-radius:14px;width:380px;max-width:100%;box-shadow:0 24px 64px rgba(0,0,0,.3);padding:1.9rem 1.8rem}' +
      '.h4fca-close{position:absolute;top:.8rem;right:.9rem;background:none;border:none;font-size:1.3rem;color:#A89F91;cursor:pointer;line-height:1}' +
      '.h4fca-badge{display:inline-block;font-size:.66rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#C8102E;border:1px solid #C8102E;border-radius:5px;padding:.1rem .4rem;margin-bottom:.7rem}' +
      '.h4fca-head h3{font-family:"Cormorant Garamond",serif;font-weight:500;font-size:1.4rem;color:#1C1A18;margin-bottom:.35rem}' +
      '.h4fca-head p{font-size:.82rem;color:#7A7268;margin-bottom:1.3rem;line-height:1.5}' +
      '.h4fca-google{width:100%;display:flex;align-items:center;justify-content:center;gap:.6rem;background:#131314;color:#e3e3e3;border:1px solid #8e918f;border-radius:20px;padding:.65rem 1rem;font-size:.85rem;font-weight:500;cursor:pointer;transition:background .2s}' +
      '.h4fca-google:hover{background:#1e1e1f}.h4fca-google svg{width:18px;height:18px}' +
      '.h4fca-divider{display:flex;align-items:center;gap:.7rem;margin:1.1rem 0;color:#A89F91;font-size:.7rem;letter-spacing:.06em;text-transform:uppercase}' +
      '.h4fca-divider::before,.h4fca-divider::after{content:"";flex:1;height:1px;background:#EDE6DC}' +
      '.h4fca-form input[type=text],.h4fca-form input[type=email]{width:100%;padding:.75rem .9rem;margin-bottom:.7rem;border-radius:6px;border:1px solid #EDE6DC;background:#fff;font-family:inherit;font-size:.9rem;outline:none;transition:border-color .2s}' +
      '.h4fca-form input:focus{border-color:#B8963E}' +
      '.h4fca-check{display:flex;align-items:flex-start;gap:.5rem;font-size:.76rem;color:#7A7268;line-height:1.4;margin-bottom:1rem}' +
      '.h4fca-check input{margin-top:.2rem}.h4fca-check a{color:#C8102E;text-decoration:underline}' +
      '.h4fca-submit{width:100%;padding:.85rem;background:#C8102E;color:#fff;border:none;border-radius:8px;font-size:.85rem;font-weight:600;letter-spacing:.03em;cursor:pointer;transition:background .2s}' +
      '.h4fca-submit:hover{background:#A00D24}.h4fca-submit:disabled{opacity:.6;cursor:wait}' +
      '.h4fca-error{color:#C8102E;font-size:.78rem;margin-top:.6rem}' +
      '.h4fca-picker{margin-bottom:.4rem}' +
      '.h4fca-prow{display:flex;align-items:center;gap:.7rem;width:100%;background:#fff;border:1px solid #EDE6DC;border-radius:8px;padding:.6rem .8rem;margin-bottom:.5rem;cursor:pointer;text-align:left;transition:border-color .15s}' +
      '.h4fca-prow:hover{border-color:#B8963E}' +
      '.h4fca-avatar{width:30px;height:30px;border-radius:50%;background:#B8963E;color:#fff;display:flex;align-items:center;justify-content:center;font-size:.76rem;font-weight:700;flex-shrink:0}' +
      '.h4fca-success{text-align:center;padding:.8rem 0}' +
      '.h4fca-success .ic{width:44px;height:44px;border-radius:50%;background:rgba(45,139,94,.12);color:#2D8B5E;display:flex;align-items:center;justify-content:center;margin:0 auto .8rem;font-size:1.4rem}' +
      '.h4fca-success h3{font-family:"Cormorant Garamond",serif;font-size:1.3rem;color:#1C1A18;margin-bottom:.4rem}' +
      '.h4fca-success p{font-size:.85rem;color:#7A7268}';
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }

  function submitLead(payload){
    return fetch(WORKER_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ email: payload.email, type:'client', name: payload.prenom || null, consent: payload.consent, fields: payload })
    }).then(function(res){
      return res.json().then(function(json){
        if(!res.ok) throw new Error(json.error || 'Erreur serveur');
        return json;
      });
    });
  }

  window.H4FClientAuth = {
    open: function(mode){
      // 'login' et 'signup' ouvrent le même formulaire (aucun back-end reel
      // ne distingue encore un compte existant d'un nouveau) — seul le
      // libelle change, pour respecter le pattern connexion/inscription
      // classique attendu depuis le menu compte.
      var isLogin = mode === 'login';
      injectStyles();
      var overlay = document.createElement('div');
      overlay.className = 'h4fca-overlay';
      var rows = DEMO_ACCOUNTS.map(function(a, i){
        return '<button type="button" class="h4fca-prow" data-idx="' + i + '">' +
          '<span class="h4fca-avatar">' + a.given_name[0] + '</span>' +
          '<span><b>' + a.given_name + '</b><br><span style="font-size:.76rem;color:#7A7268">' + a.email + '</span></span></button>';
      }).join('');
      overlay.innerHTML =
        '<div class="h4fca-card">' +
          '<button type="button" class="h4fca-close" aria-label="Fermer">×</button>' +
          '<div class="h4fca-head"><div class="h4fca-badge">Espace client</div>' +
            '<h3>' + (isLogin ? 'Ravi de vous revoir' : 'Trouvez votre pièce en 30 secondes') + '</h3>' +
            '<p>' + (isLogin ? 'Reconnectez-vous avec le même e-mail — aucune donnée à ressaisir.' : 'Un email suffit — pas de CGV à lire en entier, pas de dossier à monter. Ça, c’est réservé aux partenaires.') + '</p>' +
          '</div>' +
          '<button type="button" class="h4fca-google">' + GOOGLE_G_SVG + '<span>Continuer avec Google</span></button>' +
          '<div class="h4fca-picker" style="display:none">' + rows + '</div>' +
          '<div class="h4fca-divider"><span>ou</span></div>' +
          '<form class="h4fca-form">' +
            '<input type="text" name="prenom" placeholder="Prénom (facultatif)">' +
            '<input type="email" name="email" placeholder="Email *" required>' +
            '<label class="h4fca-check"><input type="checkbox" name="consent" required> J’accepte les <a href="cgv-clients.html" target="_blank">CGU/CGV Clients</a></label>' +
            '<button type="submit" class="h4fca-submit">' + (isLogin ? 'Se connecter →' : 'Continuer →') + '</button>' +
            '<p class="h4fca-error" style="display:none"></p>' +
          '</form>' +
        '</div>';
      document.body.appendChild(overlay);

      var card = overlay.querySelector('.h4fca-card');
      var form = overlay.querySelector('.h4fca-form');
      var googleBtn = overlay.querySelector('.h4fca-google');
      var picker = overlay.querySelector('.h4fca-picker');
      var emailEl = form.querySelector('[name="email"]');

      overlay.addEventListener('click', function(e){
        if(e.target === overlay || e.target.classList.contains('h4fca-close')) overlay.remove();
      });

      // Redirection immédiate vers l'espace admin dès qu'un email admin est reconnu,
      // sans attendre la soumission du formulaire (case CGU non requise dans ce cas).
      var adminTimer = null;
      emailEl.addEventListener('input', function(){
        clearTimeout(adminTimer);
        var val = emailEl.value.trim();
        adminTimer = setTimeout(function(){
          checkAdmin(val).then(function(isAdmin){
            if(isAdmin) window.location.href = ADMIN_ORIGIN;
          });
        }, 500);
      });

      googleBtn.addEventListener('click', function(){
        picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
      });
      picker.addEventListener('click', function(e){
        var row = e.target.closest('.h4fca-prow');
        if(!row) return;
        var acc = DEMO_ACCOUNTS[+row.getAttribute('data-idx')];
        form.querySelector('[name="prenom"]').value = acc.given_name;
        form.querySelector('[name="email"]').value = acc.email;
        picker.style.display = 'none';
      });

      form.addEventListener('submit', function(e){
        e.preventDefault();
        var err = form.querySelector('.h4fca-error');
        err.style.display = 'none';
        var data = {};
        new FormData(form).forEach(function(v,k){ data[k] = v; });

        clearTimeout(adminTimer);
        checkAdmin((data.email||'').trim()).then(function(isAdmin){
          if(isAdmin){ window.location.href = ADMIN_ORIGIN; return; }
          submitAsClient(data);
        });
      });

      function submitAsClient(data){
        var err = form.querySelector('.h4fca-error');
        if(!data.consent){ err.textContent = 'Merci d’accepter les CGU/CGV Clients.'; err.style.display = 'block'; return; }
        var btn = form.querySelector('.h4fca-submit');
        btn.disabled = true; var label = btn.textContent; btn.textContent = 'Connexion…';

        submitLead(data).then(function(){
          if(window.H4FAccount) window.H4FAccount.setClientSession({ email:data.email, prenom:data.prenom||'', at:Date.now() });
          card.innerHTML =
            '<div class="h4fca-success"><div class="ic">✓</div>' +
            '<h3>Bienvenue' + (data.prenom ? ', ' + data.prenom : '') + '</h3>' +
            '<p>Vous êtes connecté — direction la Hotlist pour trouver votre pièce.</p></div>';
          setTimeout(function(){
            // Sur une page verrouillée (js/access-gate.js), on recharge pour lever le verrou.
            if(window.H4F_GATE_ACTIVE) window.location.reload();
            else overlay.remove();
          }, 1600);
        }).catch(function(){
          btn.disabled = false; btn.textContent = label;
          err.textContent = 'L’envoi a échoué. Vérifiez votre connexion et réessayez.';
          err.style.display = 'block';
        });
      }
    }
  };
})();
