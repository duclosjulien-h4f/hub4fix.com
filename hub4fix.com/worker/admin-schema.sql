-- Hub4Fix — schéma de la base D1 de l'espace admin (h4f_admin).
-- À exécuter une fois dans la console D1 de Cloudflare.

-- Administrateurs : l'e-mail est la liste blanche (ADMIN_EMAILS) ; le RÔLE vit ici.
CREATE TABLE IF NOT EXISTS admins (
  sub        TEXT,                              -- identifiant Zitadel (rempli au 1er login)
  email      TEXT PRIMARY KEY,                  -- clé : l'e-mail de connexion
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'admin',     -- admin | sous-admin | comptabilite
  created_at TEXT,
  last_login TEXT
);

-- Appareils de confiance (utilisé à l'étape "approbation d'appareil").
CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,                 -- identifiant aléatoire de l'appareil
  admin_email TEXT NOT NULL,
  label       TEXT,                             -- navigateur / OS / date
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | revoked
  created_at  TEXT,
  approved_by TEXT
);

-- Journal d'audit (connexions, changements de rôle, approbations…).
CREATE TABLE IF NOT EXISTS audit (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT,
  actor  TEXT,
  action TEXT,
  detail TEXT
);
