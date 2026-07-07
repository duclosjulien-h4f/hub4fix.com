/**
 * Hub4Fix — connexion CLIENT (B2C) réelle via Zitadel OIDC (Authorization
 * Code + PKCE, client public sans secret — même schéma que worker/admin.js
 * et worker/partner.js, mais l'échange se fait ici directement dans le
 * navigateur puisque le site est statique : pas de secret à protéger côté
 * serveur pour un client public PKCE.
 *
 * Application Zitadel "espace client" — projet "Hub4Fix Clients".
 */
(function(){
  var ISSUER = 'https://hub4fix-l2itdp.ch1.zitadel.cloud';
  var CLIENT_ID = '380712988870612363';
  var REDIRECT_URI = 'https://hub4fix.com/auth-callback.html';
  var SCOPES = 'openid profile email';

  function b64url(buf){
    var bytes = new Uint8Array(buf), str = '';
    for(var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function randomString(len){
    var arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return b64url(arr.buffer);
  }
  function sha256(str){
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  }

  window.H4FZitadel = {
    // Redirige vers la page de connexion hébergée par Zitadel — connexion ET
    // inscription y vivent (lien "S'inscrire" côté Zitadel), pas besoin de
    // dupliquer un formulaire ici.
    login: function(returnTo){
      var verifier = randomString(64);
      var state = randomString(16);
      try{
        sessionStorage.setItem('h4fz_verifier', verifier);
        sessionStorage.setItem('h4fz_state', state);
        sessionStorage.setItem('h4fz_return', returnTo || window.location.href);
      }catch(e){}
      sha256(verifier).then(function(digest){
        var url = new URL(ISSUER + '/oauth/v2/authorize');
        url.searchParams.set('client_id', CLIENT_ID);
        url.searchParams.set('redirect_uri', REDIRECT_URI);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', SCOPES);
        url.searchParams.set('state', state);
        url.searchParams.set('code_challenge', b64url(digest));
        url.searchParams.set('code_challenge_method', 'S256');
        window.location.href = url.toString();
      });
    },

    // Vraie déconnexion Zitadel (invalide la session côté IdP, pas juste
    // notre marqueur local).
    logout: function(){
      var idToken = null;
      try{ idToken = localStorage.getItem('h4fz_id_token'); }catch(e){}
      try{
        localStorage.removeItem('h4fz_id_token');
        localStorage.removeItem('h4f_client_session');
      }catch(e){}
      if(window.H4FAccount) window.H4FAccount.render();
      var url = new URL(ISSUER + '/oidc/v1/end_session');
      if(idToken) url.searchParams.set('id_token_hint', idToken);
      url.searchParams.set('post_logout_redirect_uri', 'https://hub4fix.com/');
      window.location.href = url.toString();
    }
  };
})();
