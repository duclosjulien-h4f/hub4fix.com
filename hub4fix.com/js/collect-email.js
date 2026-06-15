/**
 * Hub4Fix — Client-side email collector
 * Envoie les inscriptions au Cloudflare Worker qui commit dans GitHub.
 *
 * Usage :
 *   h4fCollect({ email: '...', type: 'client|modelisateur|printer', name: '...' })
 *     .then(res => ...)
 *     .catch(err => ...)
 *
 * La variable WORKER_URL doit etre mise a jour apres deploiement du Worker.
 */
(function(){
  // *** A REMPLACER apres deploiement du Worker Cloudflare ***
  var WORKER_URL = 'https://h4f-collect.duclosjulien.workers.dev';

  window.h4fCollect = function(data) {
    if (!data || !data.email || !data.type) {
      return Promise.reject(new Error('email et type requis'));
    }

    return fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: data.email,
        type: data.type,
        name: data.name || null,
        // CGV consent (partenaires) : version + horodatage, valeur probante
        consent: data.consent || null,
        // fiche d'inscription complete (champs du formulaire)
        fields: data.fields || null
      })
    })
    .then(function(res) {
      return res.json().then(function(json) {
        if (!res.ok) throw new Error(json.error || 'Erreur serveur');
        return json;
      });
    });
  };
})();
