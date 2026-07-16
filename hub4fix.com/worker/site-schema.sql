-- Hub4Fix — schéma de la base D1 du back-end "site" (comptes, commandes, maillage).
-- À exécuter une fois dans la console D1 de Cloudflare.
-- Cf. context/PLAN_BACKEND_SITE.md pour le raisonnement derrière ces choix.
-- Complète worker/admin-schema.sql (admins/devices/audit), ne le remplace pas.

-- Identité : un même e-mail peut cumuler client ET partenaire (role est le rôle
-- de connexion par défaut, la présence de lignes dans les tables de profil ci-dessous
-- fait foi pour savoir quels espaces sont réellement ouverts).
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,                 -- identifiant interne (uuid)
  sub        TEXT,                             -- identifiant Zitadel (rempli au 1er login, pros/admins)
  email      TEXT UNIQUE NOT NULL,
  prenom     TEXT,
  nom        TEXT,
  role       TEXT NOT NULL DEFAULT 'client',   -- client | modelisateur | printer | admin
  auth_provider TEXT,                          -- password | google | passkey
  password_hash TEXT,                          -- B2C : PBKDF2 au format "pbkdf2$<iter>$<saltb64>$<hashb64>". NULL pour les comptes OIDC.
  email_verified INTEGER NOT NULL DEFAULT 0,   -- 0/1 — pour le B2C, la livraison numérique par e-mail fait office de validation
  -- Profil (obligatoires : email + nom + prenom ; les suivants sont FACULTATIFS) --
  adresse      TEXT,                           -- FACULTATIF — cf. note RGPD/minimisation : la livraison passe par point relais à la commande
  telephone    TEXT,                           -- FACULTATIF
  pseudo       TEXT,                           -- FACULTATIF (unique seulement s'il est affiché publiquement — à décider)
  avatar_key   TEXT,                           -- FACULTATIF — clé R2 "avatars/<id>" ; l'image vit dans R2, pas dans D1
  social_links TEXT,                           -- FACULTATIF — JSON [{"reseau":"instagram","url":"..."}]
  created_at TEXT,
  last_login TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Client B2C : localisation DÉCLARATIVE uniquement (CP/commune/quartier), jamais
-- l'adresse complète, jamais liée à une commande précise. Sert au maillage/zones
-- blanches, pas au matching FIFO (cf. orders.locker_lat/lon pour ça).
CREATE TABLE IF NOT EXISTS client_profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id),
  code_postal   TEXT,
  commune_insee TEXT,                          -- code commune INSEE (geo.api.gouv.fr)
  quartier      TEXT,                          -- best-effort, source OSM/Overpass
  declared_lat  REAL,                           -- centroïde approx. du quartier/commune, pas un GPS précis
  declared_lon  REAL,
  updated_at    TEXT
);

-- Partenaire : ADRESSE COMPLÈTE requise (facturation des prestations, royalties),
-- contrairement au client. Machines/matériaux/statut restent spécifiques au métier
-- (cf. modelisateur.html / printer.html) et vivent côté Sheet/export tant que la
-- migration D1 des inscriptions n'est pas faite ; ici seulement ce qui sert au
-- matching FIFO et à la facturation.
CREATE TABLE IF NOT EXISTS partner_profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  type         TEXT NOT NULL,                  -- modelisateur | printer
  adresse      TEXT,                           -- rue + numéro (absent des formulaires actuels, à ajouter)
  code_postal  TEXT,
  ville        TEXT,
  lat          REAL,                           -- chaînon manquant pour tout calcul FIFO — cf. PLAN_BACKEND_SITE.md §5
  lon          REAL,
  -- Pas de 2e facteur SMS : la vraie certification monetaire du partenaire
  -- est l'onboarding Stripe Connect lui-meme (KYC bancaire, souvent nom +
  -- piece d'identite + SIRET) — plus solide que la possession d'un
  -- telephone, et deja obligatoire avant tout reversement. Aucun IBAN
  -- stocke ici, Stripe le porte.
  stripe_onboarded  INTEGER NOT NULL DEFAULT 0,  -- 0/1 — onboarding Stripe Connect complete
  stripe_account_id TEXT,
  updated_at   TEXT
);

-- Consentements CGU/CGV horodatés par version — valeur probante RGPD.
CREATE TABLE IF NOT EXISTS consents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  doc        TEXT NOT NULL,                    -- cgu | cgv-clients | cgv-modelisateurs | cgv-printer
  version    TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);

-- Tokens H4F : écritures comptables append-only. Le solde est une SOMME, jamais un
-- champ qu'on écrase — c'est ce qui rend le système auditable.
CREATE TABLE IF NOT EXISTS token_ledger (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL REFERENCES users(id),
  delta    INTEGER NOT NULL,                   -- positif (crédit) ou négatif (débit)
  motif    TEXT NOT NULL,                      -- inscription | achat_fichier | hotlist_avance | ...
  ref      TEXT,                               -- id de commande / de piece liée, le cas échéant
  created_at TEXT
);

-- Réinitialisation de mot de passe : code à 6 chiffres, jamais stocké en clair
-- (on garde son empreinte SHA-256), à usage unique, expirant vite (15 min).
CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  code_hash  TEXT NOT NULL,                  -- SHA-256 du code envoyé par e-mail
  expires_at INTEGER NOT NULL,               -- epoch (secondes)
  used       INTEGER NOT NULL DEFAULT 0,     -- 0/1 — invalidé après usage
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);

-- Bibliothèque B2C : produits achetés par un client (vue "Ma bibliothèque").
-- Séparé de `orders` (qui porte le cycle logistique/paiement) : ici on ne garde
-- que ce qu'il faut pour ré-télécharger/retrouver un achat côté client.
CREATE TABLE IF NOT EXISTS purchases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(id),
  product_id   TEXT NOT NULL,                  -- id de la pièce (feed /api/pieces.json)
  product_name TEXT,
  flux         TEXT,                           -- numerique | physique
  order_id     TEXT REFERENCES orders(id),      -- lien vers la commande, le cas échéant
  created_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);

-- Commande. locker_lat/lon capturés AU MOMENT DE LA COMMANDE (widget Mondial
-- Relay), indépendants de client_profiles : un achat pour un tiers change le
-- point de livraison sans toucher au profil déclaratif du client.
CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES users(id),
  flux        TEXT NOT NULL,                   -- numerique | physique | resilient
  statut      TEXT NOT NULL DEFAULT 'nouvelle',
  locker_id   TEXT,                            -- id renvoyé par le widget Mondial Relay
  locker_lat  REAL,
  locker_lon  REAL,
  printer_id  TEXT REFERENCES users(id),        -- printer retenu par le matching FIFO
  stripe_payment_id TEXT,
  created_at  TEXT
);

CREATE TABLE IF NOT EXISTS order_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  statut   TEXT NOT NULL,
  detail   TEXT,
  ts       TEXT
);

-- Sectorisation (grille H3 ou geohash) pour l'analyse des zones blanches : densité
-- de printers par cellule, indépendante du découpage postal (trop grossier en
-- zone urbaine dense, cf. PLAN_BACKEND_SITE.md §5).
CREATE TABLE IF NOT EXISTS zones (
  cell_id       TEXT PRIMARY KEY,               -- identifiant H3/geohash
  printer_count INTEGER NOT NULL DEFAULT 0,
  client_count  INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT
);
