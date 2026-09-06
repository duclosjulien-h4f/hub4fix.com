-- Hub4Fix — vivier de veille (branche BU du pipeline).
-- À exécuter une fois dans la console D1 de Cloudflare, sur la base h4f_admin.
--
-- Rôle : accueillir les signaux de rareté collectés par pipeline-bu, et porter
-- la trace de leur VÉRIFICATION INDÉPENDANTE. Aucune ligne ne devient
-- exploitable sans être recoupée sur une source différente de celle qui l'a
-- détectée — c'est la règle centrale du pipeline, et elle est appliquée
-- côté serveur, pas seulement affichée.

CREATE TABLE IF NOT EXISTS vivier (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- ---- ce que la collecte a trouvé (jamais modifié par la suite) ----
  date_collecte   TEXT,
  source_nom      TEXT,                          -- ex. commentreparer.com
  source_type     TEXT,                          -- forum | pieces | marque | wayback | marketplace_occasion | jarvis
  lien_preuve     TEXT,                          -- URL de la preuve, jamais le texte brut du post
  marque          TEXT,
  modele          TEXT,
  reference       TEXT,
  symptome        TEXT,                           -- description courte, pas de copie de post
  categorie_piece TEXT,
  score_rarete    INTEGER NOT NULL DEFAULT 0,     -- 0-7, grille de rareté
  details_score   TEXT,                           -- ex. retire_catalogue+signal_communautaire

  -- ---- statut ----
  -- Brut      : collecté, pas encore vérifié. État d'entrée obligatoire.
  -- Qualifie  : recoupé et confirmé sur une source indépendante.
  -- Contredit : recoupé et démenti. À conserver : c'est ce qui mesure le
  --             taux de faux positifs, donc la qualité des sélecteurs.
  -- Exclu     : signal juste, mais pièce écartée (exclusion sécurité).
  statut          TEXT NOT NULL DEFAULT 'Brut',
  note_exclusion  TEXT,

  -- ---- vérification indépendante ----
  -- verif_source est OBLIGATOIRE pour sortir de 'Brut' et doit différer de
  -- source_nom : se recouper soi-même n'est pas une vérification.
  verif_source    TEXT,
  verif_note      TEXT,
  verif_par       TEXT,                           -- e-mail de l'admin qui a tranché
  verif_le        TEXT,

  -- ---- idempotence de l'import ----
  -- Le pipeline tourne plusieurs fois par semaine et réémet les mêmes lignes.
  -- Cette clé rend l'import rejouable sans créer de doublons.
  cle_dedup       TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_vivier_statut ON vivier (statut);
CREATE INDEX IF NOT EXISTS idx_vivier_score  ON vivier (score_rarete DESC);
CREATE INDEX IF NOT EXISTS idx_vivier_ref    ON vivier (reference);
