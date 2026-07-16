/* ============================================================
 * Hub4Fix — Recherche "IA" v1 (compréhension du langage naturel)
 *
 * v1 = pré-IA assumée : pas d'appel LLM (gratuit, instantané, hors-ligne).
 * On normalise la phrase dictée par le client, on en extrait des intentions
 * (type d'appareil, marque, symptôme/pièce) via un dictionnaire de synonymes,
 * puis on classe le feed central des pièces (/api/pieces.json).
 * v2 (plus tard) : endpoint Worker + Claude Haiku pour une vraie compréhension.
 *
 * Usage : inclure ce script sur une page contenant un bloc
 *   <div class="ai-search-wrap"> ... <input> ... <div class="ai-search-results">
 * Il s'auto-branche sur chaque .ai-search-wrap présent.
 * ============================================================ */
(function () {
  'use strict';

  var API_ORIGIN = 'https://h4f-admin.duclosjulien.workers.dev';
  var FEED_URL = API_ORIGIN + '/api/pieces.json';

  // ---- Dictionnaire d'intentions (langage courant -> concept) ----
  // Chaque entrée : concept canonique -> variantes que le client peut dicter.
  var SYNONYMS = {
    // Types d'appareil / catégories
    'lave-linge': ['machine a laver', 'lave linge', 'lave-linge', 'laveuse', 'lavelinge'],
    'lave-vaisselle': ['lave vaisselle', 'lave-vaisselle', 'lavevaisselle'],
    'refrigerateur': ['frigo', 'refrigerateur', 'refrigérateur', 'rfrigidaire', 'frigidaire'],
    'aspirateur': ['aspirateur', 'aspi', 'balai'],
    'cafetiere': ['cafetiere', 'cafetière', 'machine a cafe', 'machine cafe', 'expresso', 'percolateur'],
    'micro-ondes': ['micro onde', 'micro-onde', 'micro ondes', 'microonde'],
    'seche-linge': ['seche linge', 'sèche-linge', 'seche-linge', 'sechelinge'],
    'four': ['four', 'cuisiniere', 'cuisinière'],
    'robot': ['robot', 'mixeur', 'blender', 'petrin', 'pétrin', 'hachoir'],
    'tondeuse': ['tondeuse', 'rasoir', 'epilateur', 'épilateur'],
    // Symptômes / pièces fréquentes
    'poignee': ['poignee', 'poignée', 'clenche', 'ouverture porte'],
    'bouton': ['bouton', 'touche', 'molette', 'poussoir'],
    'roue': ['roue', 'roulette', 'roulettes'],
    'charniere': ['charniere', 'charnière', 'gond'],
    'bac': ['bac', 'tiroir', 'compartiment', 'reservoir', 'réservoir'],
    'filtre': ['filtre', 'grille filtre'],
    'engrenage': ['engrenage', 'pignon', 'roue dentee', 'roue dentée'],
    'clip': ['clip', 'clipsage', 'attache', 'fixation', 'agrafe'],
    'support': ['support', 'pied', 'patin', 'cale']
  };

  // Marques courantes (matchées telles quelles, tolérantes aux accents)
  var BRANDS = ['bosch', 'siemens', 'seb', 'moulinex', 'tefal', 'rowenta', 'philips', 'delonghi',
    'krups', 'whirlpool', 'samsung', 'lg', 'electrolux', 'candy', 'beko', 'brandt', 'faure',
    'dyson', 'karcher', 'miele', 'ariston', 'indesit', 'thomson', 'calor', 'magimix'];

  // Mots vides à ignorer
  var STOP = ['je', 'jai', "j'ai", 'ai', 'cherche', 'recherche', 'veux', 'besoin', 'dun', 'dune',
    'de', 'du', 'la', 'le', 'les', 'un', 'une', 'des', 'pour', 'mon', 'ma', 'mes', 'est',
    'casse', 'cassee', 'cassé', 'cassée', 'reparer', 'réparer', 'piece', 'pièce', 'et', 'avec', 'sur'];

  function normalize(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // enlève les accents
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Transforme la phrase en un jeu de termes de recherche pondérés
  function parseIntent(query) {
    var norm = normalize(query);
    var terms = [];       // termes à chercher dans le catalogue
    var raw = norm.split(' ').filter(function (w) { return w && STOP.indexOf(w) === -1; });

    // Concepts (appareil / pièce) via synonymes
    Object.keys(SYNONYMS).forEach(function (concept) {
      var variants = SYNONYMS[concept];
      for (var i = 0; i < variants.length; i++) {
        if (norm.indexOf(normalize(variants[i])) !== -1) { terms.push(concept); break; }
      }
    });
    // Marques
    BRANDS.forEach(function (b) { if (norm.indexOf(b) !== -1) terms.push(b); });
    // Mots restants significatifs (>2 lettres)
    raw.forEach(function (w) { if (w.length > 2 && terms.indexOf(w) === -1) terms.push(w); });

    return terms;
  }

  // Score d'une pièce vis-à-vis des termes extraits
  function scoreProduct(p, terms) {
    var hay = normalize([p.name, p.machine, p.category].join(' '));
    var score = 0;
    terms.forEach(function (t) {
      var nt = normalize(t);
      if (!nt) return;
      if (hay.indexOf(nt) !== -1) score += (p.name && normalize(p.name).indexOf(nt) !== -1) ? 3 : 1;
    });
    return score;
  }

  // ---- Chargement du feed (mis en cache mémoire pour la session) ----
  var _cache = null, _pending = null;
  function loadFeed() {
    if (_cache) return Promise.resolve(_cache);
    if (_pending) return _pending;
    _pending = fetch(FEED_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        _cache = (data && Array.isArray(data.products)) ? data.products : [];
        return _cache;
      })
      .catch(function () { _cache = []; return _cache; });
    return _pending;
  }

  function search(query) {
    var terms = parseIntent(query);
    if (!terms.length) return Promise.resolve([]);
    return loadFeed().then(function (products) {
      return products
        .map(function (p) { return { p: p, s: scoreProduct(p, terms) }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 8)
        .map(function (x) { return x.p; });
    });
  }

  // ---- Rendu du menu de résultats ----
  function thumbUrl(p) { return p.image ? (API_ORIGIN + p.image) : null; }

  function renderResults(box, products, query) {
    box.innerHTML = '';
    if (!products.length) {
      box.innerHTML = '<div class="ai-result-empty">Aucune pièce trouvée pour « ' +
        escapeHtml(query) + ' ». Ajoutez-la à la liste de demande depuis « Nos produits ».</div>';
      box.classList.add('visible');
      return;
    }
    products.forEach(function (p) {
      var a = document.createElement('a');
      a.className = 'ai-result';
      a.href = 'produits.html?q=' + encodeURIComponent(query) + '&id=' + encodeURIComponent(p.id || '');
      var t = thumbUrl(p);
      a.innerHTML =
        (t ? '<img class="ai-result-thumb" src="' + t + '" alt="" loading="lazy">'
           : '<span class="ai-result-thumb"></span>') +
        '<span class="ai-result-body">' +
          '<span class="ai-result-name">' + escapeHtml(p.name || 'Pièce') + '</span>' +
          '<span class="ai-result-meta">' + escapeHtml(p.machine || p.category || '') + '</span>' +
        '</span>';
      box.appendChild(a);
    });
    box.classList.add('visible');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- Auto-branchement sur chaque barre présente ----
  function wire(wrap) {
    var input = wrap.querySelector('input');
    var box = wrap.querySelector('.ai-search-results');
    if (!input || !box) return;
    var timer = null;

    function run() {
      var q = input.value.trim();
      if (q.length < 2) { box.classList.remove('visible'); return; }
      search(q).then(function (products) { renderResults(box, products, q); });
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(run, 180);
    });
    input.addEventListener('focus', function () { if (input.value.trim().length >= 2) run(); });
    // Entrée : ouvrir la page produits avec la requête
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var q = input.value.trim();
        if (q) window.location.assign('produits.html?q=' + encodeURIComponent(q));
      }
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) box.classList.remove('visible');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.ai-search-wrap').forEach(wire);
  });

  // Exposé pour la page "Nos produits" (réutilise le même moteur)
  window.H4FSearch = { search: search, parseIntent: parseIntent, loadFeed: loadFeed, normalize: normalize };
})();
