#!/usr/bin/env bash
#
# Hub4Fix — assemble le site publiable dans _site/.
#
# SOURCE DE VÉRITÉ UNIQUE de « ce qui a le droit d'être public ». Appelé par
# GitHub Actions et par Cloudflare Pages, pour que changer d'hébergeur ne
# puisse pas réintroduire une fuite que l'autre avait déjà bouchée.
#
# Le dossier hub4fix.com/ mélange le site et le code qui le sert : la source
# des workers, leurs schémas SQL, leurs wrangler.toml (identifiants de bases
# D1, noms de buckets, noms des secrets). Publier ce dossier tel quel — ce que
# faisait le déploiement d'origine — servait tout cela sur le domaine de prod.
#
# Le script échoue plutôt que de publier quelque chose de douteux. Un
# déploiement raté est visible ; une fuite silencieuse ne l'est pas.
#
# Usage :  ./build-site.sh    → produit _site/
set -euo pipefail

cd "$(dirname "$0")"

SRC="hub4fix.com"
OUT="_site"

[ -d "$SRC" ] || { echo "ERREUR : dossier source $SRC/ introuvable."; exit 1; }

rm -rf "$OUT"
cp -a "$SRC/." "$OUT/"

# ---------------------------------------------------------------------------
# Ce qui n'est pas destiné à un navigateur
# ---------------------------------------------------------------------------
rm -rf "$OUT/worker"   # source des workers, schémas SQL, wrangler.toml
rm -rf "$OUT/tools"    # scripts node d'outillage
rm -rf "$OUT/tests"    # tests unitaires
rm -rf "$OUT/leads"    # dossiers de dépôt, vides

# Outils internes, référencés par aucune page du site. Ils portaient un mot de
# passe en clair, ce qui n'était pas une protection mais son apparence.
rm -f "$OUT/hotlist-admin.html"
rm -f "$OUT/admin-demo.html"

# NB : src/ est conservé. Ce n'est pas sensible (l'équivalent compilé est
# public de toute façon) et app.html y renvoie encore (/src/main.tsx).

# ---------------------------------------------------------------------------
# Garde-fou — trois contrôles indépendants
# ---------------------------------------------------------------------------
echec=0

# 1) Par extension : configurations, schémas, clés.
if find "$OUT" -type f \
     \( -name '*.toml' -o -name '*.sql' -o -name '.dev.vars' \
        -o -name '*.pem' -o -name '*.key' -o -name '*.p12' \) | grep .; then
  echo "ERREUR : fichier de configuration, de schéma ou de clé dans le site publié."
  echec=1
fi

# 2) Par emplacement.
if [ -d "$OUT/worker" ]; then
  echo "ERREUR : $OUT/worker existe encore."
  echec=1
fi

# 3) Par contenu. Les deux contrôles ci-dessus ne voient pas du code serveur
# rangé sous un autre nom : un admin.js copié dans _site/backend/ les
# franchissait tous les deux. Ces marqueurs n'ont aucune raison d'apparaître
# dans un fichier destiné au navigateur, et ils sont présents dans tout code
# de worker — le code est donc attrapé par ce qu'il contient, pas seulement
# par où il se trouve.
for marqueur in SESSION_SECRET GOOGLE_SA_KEY PIPELINE_TOKEN SLICER_SECRET \
                database_id d1_databases r2_buckets; do
  if grep -rlF "$marqueur" "$OUT" 2>/dev/null | grep .; then
    echo "ERREUR : marqueur de code serveur « $marqueur » dans le site publié (fichiers ci-dessus)."
    echec=1
  fi
done

if [ "$echec" -ne 0 ]; then
  echo
  echo "Publication interrompue. Corriger ce qui précède, ou — si le fichier"
  echo "doit vraiment être public — ajouter son exception dans build-site.sh"
  echo "en écrivant pourquoi."
  exit 1
fi

echo "OK — site publiable assemblé dans $OUT/"
echo "Pages HTML : $(find "$OUT" -maxdepth 1 -name '*.html' | wc -l)"
echo "Poids      : $(du -sh "$OUT" | cut -f1)"
