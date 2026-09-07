# Triage des 26 pièces — laquelle fabriquer en premier

Fait le 2026-09-07, à partir de `hub4fix.com/data/hotlist.json`. Aucune donnée
externe : uniquement ce que contient le dépôt, plus le jugement mécanique.

**Constat de départ : 26 pièces repérées, 0 modélisée.** Le vivier ne rapporte
rien tant qu'une pièce n'existe pas. La seule question qui compte est donc :
par laquelle commencer.

---

## 1. Le `priority_score` ne peut pas servir à décider

Corrélation entre `alerts` et `priority_score` sur les 24 pièces qui en ont
un : **0,001**. Aucune.

Le cas qui le démontre sans discussion — deux entrées, la même pièce, le même
nombre d'alertes :

| Pièce | Alertes | Score |
|---|---|---|
| Poignée de porte sèche-linge (3 tétons) — Bosch | 15 | **5,87** |
| Poignée de porte sèche-linge (3 tétons) — Siemens | 15 | **1,96** |

Même géométrie, même groupe (BSH), même mode de casse. Un facteur 3 entre les
deux scores. La cause probable : les champs qui devraient nourrir le calcul
(`demand`, `units`, `age`) sont vides ou nuls sur 11 des 26 fiches.

**Conséquence** : ce classement se fait sur `alerts` — un comptage réellement
observé lors de la veille de mai — et sur la faisabilité mécanique. Le score
est ignoré. Il faudra soit le recalculer, soit le retirer : le laisser affiché
donne une fausse impression de rigueur.

---

## 2. Écartées par vos propres règles de sécurité

Le briefing exclut : pièces sous pression, forte chaleur, sécurité électrique,
pièces structurelles ou porteuses. Six entrées tombent dedans, dont deux
franchement.

| Pièce | Motif |
|---|---|
| **Bouton/levier de verrouillage du couvercle — Cookeo** | Le Cookeo est un **autocuiseur**. Ce levier est l'interverrouillage de sécurité qui empêche l'ouverture sous pression. Rédhibitoire. |
| **Cache-valve du couvercle — Cookeo** | Clip de la **valve d'évacuation vapeur**. Même appareil, même interdit. |
| **Charnière de porte lave-vaisselle (ressort + câble) — Bosch** | Porte lourde + **énergie stockée** dans le ressort. Une rupture lâche la porte. |
| **Charnière de hublot lave-linge — Indesit** | Pièce porteuse : elle tient le hublot. |
| **Cadre supérieur / charnière-axe de capot — Haier top** (15 alertes) | Cadre = **structurel**. Grande pièce sollicitée en flexion. |
| **Cadre supérieur + charnières + loquet — Hoover top** | Idem. |

**Deux cas limites, que je propose aussi d'écarter :**

- **Knee-lever capsule — Nespresso Inissia/Pixie** (13 alertes)
- **Levier porte-capsule — Dolce Gusto** (10 alertes)

Ces leviers ne sont pas des pièces sous pression au sens strict, mais ils
**transmettent l'effort qui referme et étanche la chambre à capsule**, sur des
machines à 15-19 bar. Une rupture en cours de cycle met de l'eau chaude sous
pression en jeu. Le gain commercial ne vaut pas ce risque, et c'est
exactement l'esprit de la règle.

---

## 3. Doublons à fusionner

Trois paires décrivent la même pièce, ce qui gonfle artificiellement le vivier
et fausse tout comptage :

| Doublon | Alertes cumulées |
|---|---|
| Tige de détection du tiroir à marc De'Longhi (deux entrées : « Magnifica S / ETAM / Dinamica » et « ECAM 21.117… ») | 10 + 10 |
| Poignée de porte sèche-linge (Bosch et Siemens, groupe BSH, pièce commune) | 15 + 15 |
| Roulette de panier inférieur LV (AEG/Electrolux et Bosch/Siemens/Neff — géométries proches, pas identiques) | 11 + 11 |

Les deux premières sont de vrais doublons. La troisième mérite vérification :
les roulettes AEG et BSH se ressemblent mais ne sont probablement pas
interchangeables.

**26 entrées ne font donc pas 26 pièces distinctes. Plutôt 23.**

---

## 4. Les candidates réellement imprimables

Classées par faisabilité décroissante. « Faisabilité » = petite pièce,
plastique à l'origine, effort modéré, pas de chaleur ni de pression, pas de
fonction de sécurité.

| # | Pièce | Alertes | Pourquoi elle convient |
|---|---|---|---|
| 1 | **Tige de détection du tiroir à marc — De'Longhi** | 20 (fusionné) | Une tige. Aucun effort mécanique, elle pousse un micro-switch. Le print le plus simple de toute la liste. |
| 2 | **Gâchette d'ouverture du réceptacle — Dyson V8/V10/V11** | 10 | Petite, plastique, retour par ressort, aucun effort structurel. Parc énorme, pièce d'origine chère et distribuée au compte-gouttes. |
| 3 | **Roulette de panier inférieur LV — BSH puis AEG** | 11 + 11 | Le classique de l'impression 3D. Charge faible, eau à 65 °C, aucune sécurité. Parc BSH considérable. |
| 4 | **Poignée de porte sèche-linge (3 tétons) — BSH** | 30 (fusionné) | La plus demandée de la liste. Les tétons cassent, c'est le mode de défaillance connu. Attention à l'orientation des couches : les tétons travaillent en cisaillement. |
| 5 | **Roulettes de traîneau — Rowenta Silence Force** | 10 | Charge triviale, aucune sécurité. Facile. |
| 6 | **Charnière/tenons du portillon de freezer** | 11 | Petite, effort faible. **Le froid fragilise** : PETG ou ABS, jamais du PLA. |
| 7 | **Support de clipsage du bras d'aspersion LV — BSH** | 10 | Raccord rapide à ailettes. Petit, eau chaude, sans effort notable. |
| 8 | **Clips + butées de rail du panier supérieur LV — BSH** | 10 | Petites pièces de guidage. |
| 9 | **Entraîneur d'axe moteur — Moulinex Companion** | 10 | **Pièce sacrificielle par conception** : elle cède pour protéger le moteur. Donc déjà pensée comme consommable. Contact alimentaire à vérifier. |
| 10 | **Entraîne-pale (came) — Tefal Actifry** | 11 | Transmet un couple, et l'Actifry chauffe. Matériau technique nécessaire. |
| 11 | **Trappe de condenseur — sèche-linge Whirlpool** | 10 | Charnière + joint, milieu chaud et humide. Le joint complique. |
| 12 | **Charnière/clip de couvercle — Companion** | 10 | Le Companion n'est pas un autocuiseur (il est ventilé), donc pas exclu. Mais effort réel sur la charnière. |

**Un cas à part** : le **pignon de sécurité du robot KitchenAid Artisan**
(10 alertes). La demande est réelle et la pièce d'origine coûte cher, mais
c'est un engrenage qui transmet un couple important. La résistance des dents en
dépôt de filament est le point faible connu de la technique. À ne pas prendre
comme première pièce.

---

## 5. Recommandation : commencer par la tige De'Longhi

**Pourquoi elle et pas la plus demandée.** La poignée de sèche-linge BSH cumule
30 alertes, c'est la plus réclamée. Mais ses tétons travaillent en cisaillement,
donc l'orientation d'impression décide de la réussite — un premier essai risque
d'échouer pour une raison purement technique, sans rien dire du modèle
économique.

La tige De'Longhi ne porte **aucun effort** : elle pousse un contacteur. Le
risque technique est quasi nul. Elle sert donc à valider la chaîne complète —
mesure, modélisation, impression, ajustement, vente — sur un cas où seule
l'organisation peut échouer, pas la physique.

**Puis, dans l'ordre :** la gâchette Dyson (meilleur dossier commercial : parc
énorme, pièce chère, approvisionnement verrouillé par le fabricant), les
roulettes de panier BSH (volume), et enfin la poignée de sèche-linge une fois
qu'on saura imprimer des tétons qui tiennent.

---

## 6. Ce que ce triage ne dit pas

Il repose sur les seules données du dépôt. Trois choses restent à vérifier, et
aucune ne peut l'être depuis cette session :

- **La disponibilité réelle** de chaque pièce chez le fabricant. Une pièce
  encore vendue à 4 € ne vaut pas d'être modélisée. Le briefing rappelle le cas
  Samsung DC92-01223C, annoncée épuisée et en fait disponible.
- **Les cotes**, qui demandent la pièce en main ou une vue éclatée.
- **Le prix d'origine**, qui décide de la marge.

Le premier point est le plus important : il peut annuler n'importe quelle ligne
de ce classement.
