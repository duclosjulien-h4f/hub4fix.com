-- Base D1 "h4f_early" : registre des inscriptions early access, pour dire "déjà inscrit"
-- SANS jamais lire le Google Sheet (le Sheet ne reçoit que des ajouts de lignes).
-- Une adresse n'est jamais stockée en clair ici : seulement son empreinte SHA-256
-- (e-mail en minuscules, sans espaces) + le profil. Suffisant pour détecter un doublon,
-- inutilisable pour retrouver l'adresse.
-- Appliquer : npx wrangler d1 execute h4f_early --remote --file=early-schema.sql
CREATE TABLE IF NOT EXISTS early_signups (
  email_hash TEXT NOT NULL,
  profil     TEXT NOT NULL,          -- modelisateur | printer
  created_at TEXT NOT NULL,
  PRIMARY KEY (email_hash, profil)   -- la contrainte d'unicité EST la détection de doublon
);
