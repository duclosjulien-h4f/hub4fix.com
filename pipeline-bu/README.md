# Pipeline BU (Bottom-Up) — Hub4Fix

Collecte proactive de signaux de rareté de pièces détachées à partir de sources externes.

## Principe

Partir des **signaux déjà exprimés** (forums, avis SAV, marketplaces) pour identifier des pièces rares avant même qu'un client ne les demande sur le site.

## Grille de scoring rareté (0-7 points)

| # | Critère | Points |
|---|---------|--------|
| 1 | Marque disparue / rachetée / SAV arrêté | 1 |
| 2 | Ancienneté forte (>7-10 ans) | 1 |
| 3 | Marque étrangère sans réseau SAV France | 1 |
| 4 | Rupture fournisseur constatée (délai >4-6 sem.) | 1 |
| 5 | Référence retirée des catalogues officiels | 1 |
| 6 | Signaux communautaires répétés (forums, avis) | 1 |
| 7 | Prix anormal sur marché gris (occasion) | 1 |

**Score ≥ 3 → candidat sérieux à vérification indépendante.**

## Sources actives

| Priorité | Source | Type | Automatisé |
|----------|--------|------|-----------|
| 1 | Vivier existant (hotlist.json) | Interne | Référence pour vérif croisée |
| 2 | commentreparer.com | Forum | Oui |
| 3 | forum.adepem.com | Forum | Oui |
| 4 | forum.quechoisir.org | Forum | Oui |
| 5 | SOS Accessoire, Spareka, Fixpart, Rechange Express | Pièces | Oui |
| 6 | Pages SAV officielles marques | Marque | Oui |
| 7 | eBay.fr (annonces vendues) | Occasion | Oui |
| 8 | Wayback Machine (CDX API) | Archive | Oui |
| — | Leboncoin | Occasion | **Manuel uniquement** (CGU §8.2) |
| — | Donnons.org, Geev | Dons | **Claude Chrome supervisé** (login requis) |
| — | Facebook, Discord | Communauté | **Manuel** |

## Règles immuables

- **Jamais stocker le texte brut des posts** — seulement les faits extraits (ref, symptôme court, lien)
- **Rate limiting : 2 secondes** entre chaque requête réseau
- **Vérifier robots.txt** avant d'ajouter une nouvelle source en rotation
- **Pas de contournement CAPTCHA** ni de protection anti-bot, quelle que soit la source
- Toute pièce reste en statut `Brut` jusqu'à **vérification indépendante**

## Lancer le script manuellement

```bash
cd pipeline-bu/scripts
python3 collecte_pipeline.py
```

Résultat dans `pipeline-bu/data/vivier_brut_collecte.csv` (non versionné — voir `.gitignore`).

## Automatisation

GitHub Actions lance le script 4x/semaine (lun/mar/jeu/ven à 06h00 UTC).
Les résultats sont uploadés comme **artifact téléchargeable** (accès authentifié, non public).
