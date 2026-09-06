# Journal de test — Pipeline BU

Le cron est **désarmé** dans `.github/workflows/collecte-bu.yml`. Le pipeline tourne
à la main, lancé depuis Claude Code, le temps de savoir ce que valent réellement les
sélecteurs d'extraction. Ce fichier est le matériau qui décidera de l'armement.

## Lancer un passage

```bash
# une famille de sources à la fois, sans rien écrire — pour juger les sélecteurs
python3 pipeline-bu/scripts/collecte_pipeline.py --source forums --limit 2 --dry-run

# passage complet, écrit le CSV et le journal de run
python3 pipeline-bu/scripts/collecte_pipeline.py
```

Familles : `forums` · `pieces` · `marques` · `marketplaces` · `all`

## Ce qu'on cherche à savoir

Le script n'a jamais tourné contre les vraies sources. Quatre questions, dans cet ordre :

1. **Les sources répondent-elles ?** Un 403 systématique sur un forum veut dire que
   le `User-Agent` est refusé ou que la page de recherche exige une session. Ce n'est
   pas un bug du script, c'est une source à retirer ou à traiter autrement.
2. **Les sélecteurs trouvent-ils quelque chose ?** Les motifs de titres sont des
   heuristiques écrites sans voir le HTML réel. S'ils ramènent 0 signal sur une source
   qui répond en 200, c'est le sélecteur qu'il faut corriger.
3. **Le bruit est-il tolérable ?** Un signal juste doit être plus fréquent qu'un faux.
   Au-delà d'un faux sur deux, le temps de tri humain annule le gain.
4. **Le score discrimine-t-il ?** Si tout sort à 1/7, la grille ne trie rien et il
   faut revoir la détection des critères, pas le seuil.

## Critères d'armement du cron

Le cron ne se réactive pas « quand ça a l'air de marcher ». Il se réactive quand :

- [ ] Au moins **3 passages manuels** consécutifs sans erreur non expliquée
- [ ] Au moins **2 familles de sources** produisent des signaux exploitables
- [ ] Le taux de faux positifs est **inférieur à 1 sur 3** sur un échantillon relu à la main
- [ ] Au moins **1 signal** a été promu `Qualifié` après vérification indépendante —
      preuve que la chaîne complète produit quelque chose d'utile, pas seulement des lignes
- [ ] Les sources qui répondent systématiquement en erreur ont été **retirées** de la rotation

Tant qu'une case n'est pas cochée, le cron reste commenté.

---

## Passages

Un bloc par passage. Rester factuel : ce qui a répondu, ce qui n'a rien donné, ce qui
a été corrigé ensuite.

### Modèle à copier

```
### AAAA-MM-JJ — passage N
Commande   : --source … --limit …
Réponses   : quelles sources en 200, lesquelles en erreur (et quel code)
Signaux    : combien par famille, score max obtenu
Relu main  : X signaux vérifiés → Y justes, Z faux
Correction : ce qui a été changé dans le script après ce passage
Reste      : ce qui bloque encore
```

### 2026-09-06 — passage 0 (à blanc, sans réseau)

```
Commande   : --source marketplaces --limit 1 --dry-run
Réponses   : aucune — l'environnement de dev n'a pas d'accès sortant
             (403 du proxy sur ebay.fr, idem sur les forums et web.archive.org)
Signaux    : 0, attendu
Relu main  : —
Correction : ajout des options --source / --limit / --dry-run pour pouvoir
             itérer source par source pendant la phase de test
Reste      : tout. Le premier passage réel doit se faire depuis une machine
             avec accès réseau sortant, ou via workflow_dispatch sur GitHub
             Actions (le runner GitHub, lui, a le réseau).
```
