-- Hub4Fix — base "h4f_partner" (worker h4f-partner : espace partenaires).
-- Séparée de h4f_admin (admins) et h4f_site (clients B2C). L'auth est Zitadel ;
-- chaque partenaire est LIÉ à un compte D1 (h4f_site.users) via le pont par email
-- (retrouvé s'il existe déjà en B2C, créé sinon) -> le partenaire garde ses
-- capacités B2C (bibliothèque, tokens, achats).
--
-- Appliquer :  npx wrangler d1 execute h4f_partner --remote --file ../partner-schema.sql

-- Statut partenaire d'un compte. user_id = id du compte D1 lié (h4f_site.users.id).
-- Un même compte peut cumuler plusieurs types (modelisateur ET printer) -> unicité (user_id, type).
CREATE TABLE IF NOT EXISTS partners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,                    -- compte D1 lié (le pont)
  email       TEXT NOT NULL,                    -- email de liaison (dénormalisé, lecture rapide)
  type        TEXT NOT NULL,                    -- modelisateur | printer
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | active | rejected | suspended
  motivation  TEXT,                             -- candidature
  portfolio   TEXT,
  created_at  TEXT,
  decided_at  TEXT,
  decided_by  TEXT                              -- admin ayant tranché
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_user_type ON partners(user_id, type);
CREATE INDEX IF NOT EXISTS idx_partners_status ON partners(status, type);

-- Réservations de pièces par les modélisateurs (Hot List). DÉMÉNAGÉES ici depuis
-- h4f_site : une seule réservation bloquante par piece_id (option EXCLUSIVE).
-- Photos plaque+appareil+pièce en R2 ; ai_check = verdict de la validation IA
-- (Gemma vision) ; l'admin valide, suspend ou annule.
-- user_id = compte D1 lié du modélisateur (via le pont).
--
-- `expires_at` est la SEULE échéance qui bloque la pièce, et elle change de sens
-- selon l'étape (voir partner.js, section « horloges ») : 2 h pour envoyer les
-- photos, 7 j pour notre feu vert, 72 h pour déposer le fichier, 60 j pour
-- l'examen. Une seule colonne, donc aucun risque de deux vérités qui divergent.
CREATE TABLE IF NOT EXISTS reservations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,                     -- compte D1 lié du modélisateur
  status       TEXT NOT NULL DEFAULT 'active',    -- pending-review | active | submitted | suspended | cancelled | expired | done
  plate_key    TEXT,
  object_key   TEXT,
  part_key     TEXT,                              -- 3e photo : la pièce seule (facultative)
  ai_check     TEXT,
  created_at   TEXT,
  expires_at   TEXT,
  renewed_at   TEXT,
  validated_at TEXT,                              -- feu vert admin : ancre les 72 h
  extended_at  TEXT,                              -- prolongation unique déjà consommée
  decided_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_reservations_piece ON reservations(piece_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id, status);

-- La table `submissions` (fichiers déposés + acte de cession horodaté) vit dans
-- `tunnel-schema.sql`, à appliquer ensuite. Elle n'est pas dupliquée ici : un
-- schéma en deux copies finit toujours par diverger.

-- Profil "parc machines" d'un printer (P1). Un seul profil par compte (user_id = compte
-- D1 lié via le pont). Rempli à la candidature printer, modifiable ensuite. Sert au
-- matching géographique (postal_code/ville) et à la compatibilité (techs + materials).
CREATE TABLE IF NOT EXISTS printer_profiles (
  user_id     TEXT PRIMARY KEY,               -- compte D1 lié (h4f_site.users.id)
  techs       TEXT,                            -- csv DÉRIVÉ des machines (FDM,SLA,...) — sert au matching
  materials   TEXT,                            -- csv global : PLA,PETG,ABS,TPU,resine,nylon...
  postal_code TEXT,                            -- code postal (matching zone)
  ville       TEXT,
  available   INTEGER NOT NULL DEFAULT 1,      -- disponible on/off (reçoit des commandes)
  machines    TEXT,                            -- json [{modele, techno, quantite}] : le parc, une ligne par imprimante/lot
  created_at  TEXT,
  updated_at  TEXT
);

-- Commandes d'impression réservables (P2). Vue PRINTER d'une commande physique :
-- snapshot de ce dont le printer a besoin pour décider (montant figé au moment de la
-- création, matériau/techno requis, zone), découplé de la forme exacte de `orders`
-- (h4f_site). Réservation EXCLUSIVE (premier arrivé) via UPDATE conditionnel sur status.
-- offer_expires_at = created_at + 24h : le serveur REVÉRIFIE l'expiration à la réservation.
-- order_id NULL = commande de TEST (is_test=1) en attendant le tunnel d'achat physique B2C.
CREATE TABLE IF NOT EXISTS print_jobs (
  id               TEXT PRIMARY KEY,             -- uuid du job
  order_id         TEXT,                          -- lien vers orders (h4f_site), NULL si test
  product_id       TEXT,                          -- id pièce (feed)
  product_name     TEXT,
  material         TEXT,                          -- matériau requis (matching parc)
  tech             TEXT,                          -- techno requise (FDM par défaut v1)
  print_time       TEXT,                          -- temps de réf. brut ("2h30") — snapshot fiche
  weight           TEXT,                          -- poids brut ("12,5 g") — snapshot fiche
  montant_cents    INTEGER NOT NULL DEFAULT 0,    -- rému printer calculée (centimes), snapshot
  postal_code      TEXT,                          -- zone client/point relais (matching)
  ville            TEXT,
  status           TEXT NOT NULL DEFAULT 'open',  -- open | reserved | committed | production | done | expired | cancelled
  printer_id       TEXT,                          -- compte D1 du printer ayant réservé
  offer_expires_at TEXT,                          -- created_at + 24h (échéance absolue serveur)
  notified_circles TEXT,                          -- json des cercles notifiés (P3)
  last_circle_at   TEXT,                          -- dernier palier de mailing (P3)
  created_at       TEXT,
  reserved_at      TEXT,
  started_at       TEXT,                          -- suivi prod : impression lancée (verrouille la libération)
  succeeded_at     TEXT,                          -- suivi prod : impression réussie
  shipped_at       TEXT,                          -- suivi prod : pièce expédiée (-> status 'done')
  is_test          INTEGER NOT NULL DEFAULT 0     -- 1 = commande de test (seed admin)
);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, offer_expires_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_printer ON print_jobs(printer_id, status);
