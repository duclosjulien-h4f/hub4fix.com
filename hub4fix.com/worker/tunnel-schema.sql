-- Hub4Fix — tunnel de soumission modélisateur. Migration ADDITIVE de h4f_partner.
-- À appliquer UNE FOIS, après partner-schema.sql :
--   npx wrangler d1 execute h4f_partner --remote --file ../tunnel-schema.sql
--
-- SQLite n'a pas de « ALTER TABLE ADD COLUMN IF NOT EXISTS » : rejouer ce fichier
-- échoue sur les colonnes déjà posées. C'est voulu — l'erreur dit que c'est déjà fait.
-- Les CREATE TABLE, eux, sont idempotents.

-- ---------------------------------------------------------------- réservations
-- 3e photo : la pièce seule, quand le modélisateur l'a en main (facultative — il
-- peut n'avoir que l'appareil monté).
ALTER TABLE reservations ADD COLUMN part_key TEXT;

-- Le feu vert admin. Tant qu'il est NULL, le modélisateur n'a pas de délai qui
-- court : la pièce est bloquée pour les autres, mais son compteur n'a pas démarré.
-- C'est cette date qui ancre les 72 h, pas la date de réservation.
ALTER TABLE reservations ADD COLUMN validated_at TEXT;

-- La prolongation est UNIQUE. Cette colonne est la mémoire de cette unicité :
-- non NULL = déjà utilisée, la demande suivante est refusée.
ALTER TABLE reservations ADD COLUMN extended_at TEXT;

-- ---------------------------------------------------------------- soumissions
-- Un fichier proposé par un modélisateur pour une pièce réservée.
--
-- Deux fichiers, deux rôles distincts :
--   - le SOURCE NATIF (.f3d, .sldprt, .scad…) = l'œuvre, ce qui se retouche plus tard ;
--   - le STEP = le format d'échange ouvert, matière première de la conversion en 3MF
--     et de l'aperçu 3D. Aucun maillage (STL/3MF) n'est accepté du modélisateur :
--     le maillage est un PRODUIT de la chaîne H4F, pas une entrée.
--
-- `cession_at` est l'acte de cession HORODATÉ, exigé fichier par fichier (une
-- cession globale d'œuvres futures serait nulle, art. L.131-1 CPI ; CGV
-- modélisateurs art. 2.1). Il est lié à CE fichier par son empreinte : deux
-- versions successives portent deux actes distincts, et l'empreinte prouve
-- laquelle a été cédée.
-- DEUX PORTES D'ENTRÉE, une seule table (`origine`) :
--   'tunnel'           le modélisateur dépose depuis l'espace partenaire, sur une pièce
--                      réservée dont nous avons validé les photos.
--   'interne'          un admin dépose depuis /admin/depot (pièce modélisée par H4F).
--   'hors-tunnel'      un admin dépose le fichier d'un modélisateur reçu hors plateforme
--                      (mail, transfert) : l'acte de cession existe ailleurs, on en
--                      garde la référence.
--   'repair-together'  droits à 100 % H4F par le programme.
-- Une seule table parce que TOUT L'AVAL est commun : examen, conversion en 3MF haute
-- résolution, sceau, publication. Deux tables obligeraient l'étape de conversion à
-- gérer deux pipelines pour un résultat identique.
--
-- EXCEPTION réservée au canal interne (`mesh_only = 1`) : un maillage déjà prêt peut
-- être déposé — c'est le stock existant. Alors `native_*` porte LE MAILLAGE et `step_*`
-- est vide. Le drapeau dit ce qu'il faut savoir : la finesse de ce fichier est celle de
-- son export d'origine, elle n'a PAS été maîtrisée par notre conversion (0,01 mm /
-- 0,05 rad). À refaire depuis un STEP le jour où la cote pose problème.
--
-- `mesh_kind` tranche l'ambiguïté du mot « 3MF » (vocabulaire posé le 09/08/2026), parce
-- que les deux n'ont pas le même aval :
--   '3mf-source'   géométrie seule, sans réglages de slicing. Il reste à lui injecter un
--                  profil machine pour obtenir un master : la préparation n'est pas finie.
--   '3mf-master'   porte déjà les réglages (Metadata/project_settings.config côté Orca,
--                  Metadata/Slic3r_PE.config côté Prusa). Slicable en l'état, il peut
--                  aller directement dans h4f-masters. Le PoC l'appelle « 3MF projet ».
--   'stl'          maillage nu, sans unité déclarée ni métadonnée.
--   'indetermine'  le zip n'a pas pu être inspecté — on ne devine pas, on le dit.
--
-- Pour `origine='hors-tunnel'`, `cession_at` porte la date de l'acte signé AILLEURS et
-- `cession_ref` dit où le retrouver.
CREATE TABLE IF NOT EXISTS submissions (
  id              TEXT PRIMARY KEY,               -- uuid
  reservation_id  INTEGER,                        -- NULL pour un dépôt interne (pas de réservation)
  piece_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,                  -- compte D1 du modélisateur, ou 'admin:<email>'
  origine         TEXT NOT NULL DEFAULT 'tunnel', -- tunnel | interne | hors-tunnel | repair-together
  version         INTEGER NOT NULL DEFAULT 1,     -- 1, 2… en cas de correction demandée
  native_key      TEXT NOT NULL,                  -- R2 h4f-submissions
  native_name     TEXT NOT NULL,                  -- nom d'origine (traçabilité)
  native_ext      TEXT NOT NULL,
  native_sha256   TEXT NOT NULL,
  native_bytes    INTEGER NOT NULL DEFAULT 0,
  step_key        TEXT,                           -- NULL si mesh_only
  step_name       TEXT,
  step_sha256     TEXT,
  step_bytes      INTEGER NOT NULL DEFAULT 0,
  mesh_only       INTEGER NOT NULL DEFAULT 0,     -- 1 = maillage déposé, résolution NON maîtrisée
  mesh_kind       TEXT,                           -- 3mf-source | 3mf-master | stl | indetermine
  status          TEXT NOT NULL DEFAULT 'review', -- review | rejected | accepted | prepared | published
  cession_at      TEXT NOT NULL,                  -- acte de cession horodaté (L.131-1 CPI)
  cession_version TEXT NOT NULL,                  -- version des CGV visée par l'acte
  author_name     TEXT,                           -- auteur tiers (origine='hors-tunnel')
  cession_ref     TEXT,                           -- où retrouver l'acte signé hors plateforme
  deposited_by    TEXT,                           -- admin auteur du dépôt interne
  review_note     TEXT,                           -- motif de refus / consigne de correction
  decided_at      TEXT,
  decided_by      TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_piece ON submissions(piece_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id, status);

-- Une seule soumission par version et PAR PIÈCE : un double envoi (double clic, renvoi
-- réseau) ne peut pas créer deux dossiers concurrents. La clé porte sur la pièce et non
-- sur la réservation, pour deux raisons : un dépôt interne n'a pas de réservation (et
-- SQLite considère deux NULL comme distincts, donc l'unicité tomberait), et le numéro
-- de version décrit l'histoire DE LA PIÈCE — v1, v2, v3 — quel que soit le canal ou le
-- modélisateur qui l'a produite.
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_piece_version ON submissions(piece_id, version);
