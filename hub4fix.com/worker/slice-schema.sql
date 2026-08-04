-- Hub4Fix — passerelle Cloud Slicer. Migration ADDITIVE de la base h4f_site.
-- À appliquer après site-schema.sql :
--   npx wrangler d1 execute h4f_site --remote --file ../slice-schema.sql

-- Un slice = un job. `id` sert AUSSI de référence au débit du token : c'est ce
-- qui rend le débit rejouable sans risque (voir l'index unique plus bas).
CREATE TABLE IF NOT EXISTS slice_jobs (
  id           TEXT PRIMARY KEY,               -- job_id, transmis tel quel au service
  user_id      TEXT NOT NULL REFERENCES users(id),
  product_id   TEXT NOT NULL,                  -- pièce achetée (feed /api/pieces.json)
  source_id    TEXT NOT NULL,                  -- 3MF maître côté service (pièce × machine)
  printer      TEXT,                           -- machine choisie par le client, si précisée
  status       TEXT NOT NULL,                  -- queued | slicing | done | failed
  sn           TEXT,                           -- numéro de série gravé dans le G-code
  engine_image TEXT,                           -- image du moteur qui a produit ce G-code
  error        TEXT,
  refunded     INTEGER NOT NULL DEFAULT 0,     -- 1 = le token a été rendu
  created_at   TEXT,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_slice_jobs_user ON slice_jobs(user_id);

-- Le SN doit rester retrouvable : un G-code qui circule porte ce numéro, et c'est
-- lui qui remonte au client. Index unique = deux clients ne peuvent pas partager
-- un SN, même si le tirage aléatoire du service collisionnait.
CREATE UNIQUE INDEX IF NOT EXISTS idx_slice_jobs_sn ON slice_jobs(sn) WHERE sn IS NOT NULL;

-- Le débit d'un token est IDEMPOTENT par construction : la base refuse un second
-- (motif, ref) identique. Un renvoi de requête après timeout ne peut donc pas
-- débiter deux fois, et un remboursement ne peut pas être versé deux fois.
-- Les écritures sans ref (ex. 'inscription') ne sont pas concernées.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_motif_ref
  ON token_ledger(motif, ref) WHERE ref IS NOT NULL;
