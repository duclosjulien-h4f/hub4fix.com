# Guide de modélisation — stratégies par mode de casse

Dicté par Julien, structuré et rédigé ici. **Organisé par mode de casse**, parce
que c'est ainsi qu'on l'utilise : on a une pièce cassée devant soi, on identifie
comment elle a lâché, on cherche la technique qui répond.

> **Les sections marquées `À REMPLIR` sont vides, pas devinées.** Ce guide ne
> contient que ce que Julien a effectivement énoncé. Le reste attend, pour que
> personne ne prenne une supposition de rédaction pour une pratique validée.

---

## Le principe qui commande tout

Le fabricant est prisonnier de l'injection : angles de démoulage, épaisseur de
paroi à peu près constante, aucune cavité interne, démoulabilité obligatoire.
La fabrication additive n'a aucune de ces contraintes.

Donc **on ne recopie pas la pièce d'origine, on corrige son défaut.** Mettre la
matière là où passe la contrainte, introduire de la souplesse là où la rigidité
casse. Ce n'est pas un rattrapage des limites de l'impression 3D — c'est une
géométrie que l'injection ne sait pas produire.

C'est le même propos que la page *Kintsugi* du site : sublimer plutôt qu'imiter.

---

## La contrainte de base : l'anisotropie

Une pièce en dépôt de filament n'a pas la même résistance dans les trois
directions. Elle est solide **dans** le plan des couches, faible **entre** les
couches — c'est là qu'elle se délamine.

Toute la suite en découle : la question n'est jamais « quelle épaisseur ? » mais
**« dans quel sens passe l'effort par rapport aux couches ? »**

---

## Mode de casse 1 — Téton cisaillé à sa base

**Symptôme.** Le téton de fixation casse net au pied, souvent tous en même
temps. Cas type : la poignée de porte de sèche-linge BSH (réf. 00644221), fixée
par trois tétons plastique.

**Pourquoi l'impression directe échoue.** Un téton imprimé debout a ses couches
perpendiculaires à l'effort : la charge travaille exactement dans le plan de
délamination. Un téton plus épais mais mal orienté peut être **plus fragile**
que l'injecté d'origine.

**Stratégie : imprimer les tétons à plat, séparément, puis les insérer.**

Couché, les couches courent le long du téton. L'effort devient intra-couche au
lieu d'inter-couche — on retourne l'anisotropie à son avantage. La pièce devient
un assemblage : corps d'un côté, tétons de l'autre.

Conséquences à assumer :

- un ajustement à concevoir entre le téton et son logement (serré, collé, ou à
  épaulement) — `À REMPLIR : quel type d'ajustement retenu, quel jeu`
- une étape d'assemblage à expliquer au client
- `À REMPLIR : matière retenue pour les tétons, si différente du corps`

---

## Mode de casse 2 — Clip ou languette qui fatigue et rompt

**Symptôme.** Un clip qui a tenu des centaines de fois finit par casser. Ce
n'est pas une surcharge, c'est de la fatigue.

**Stratégie : ajouter une structure « ressort » interne qui permet de plier sans
casser.**

On cesse de résister à l'effort par la rigidité, on le laisse fléchir
élastiquement — un mécanisme compliant. La déformation se répartit sur une
longueur au lieu de se concentrer sur un pli, ce qui fait chuter la contrainte
de pointe. Et c'est typiquement une géométrie interne que l'injection ne peut
pas démouler.

`À REMPLIR : forme de ressort utilisée (lame, méandre, hélice ?), et comment
elle est dimensionnée en pratique`

---

## Modes de casse à documenter

Chacun attend la technique correspondante. Rien n'est écrit ici à la place de
Julien.

| Mode de casse | Stratégie |
|---|---|
| Filetage arraché | `À REMPLIR` |
| Axe ou pivot usé / ovalisé | `À REMPLIR` |
| Dents d'engrenage cassées | `À REMPLIR` |
| Surface de glissement usée | `À REMPLIR` |
| Pièce en flexion répétée | `À REMPLIR` |
| Écrou ou insert métallique noyé | `À REMPLIR` |
| Fonction d'étanchéité (joint) | `À REMPLIR` |
| Pièce en contact alimentaire | `À REMPLIR` |
| Pièce exposée à la chaleur | `À REMPLIR` |

---

## Choix de matière

`À REMPLIR` — quelle matière pour quel usage, et surtout les **exclusions** :
là où une matière est à proscrire (le PLA au froid dans un congélateur, par
exemple, où il devient cassant).

---

## Réglages d'impression qui comptent

`À REMPLIR` — hauteur de couche, taux de remplissage, nombre de parois,
température. Ce qui se règle par pièce et ce qui reste fixe.

---

## À quoi sert ce guide

Trois usages, dans cet ordre d'importance :

1. **Décider si une pièce est modélisable.** Une pièce n'est « corrigeable » que
   s'il existe une technique qui répond à son mode de casse. Sans ce guide, ce
   jugement se fait à l'intuition — et il commande tout le tri du vivier.
2. **Faire travailler les modélisateurs partenaires à un standard commun.** Ils
   ont un tunnel et des CGV ; il leur manque la règle de l'art.
3. **Ne pas laisser cette connaissance dans une seule tête.** C'est aujourd'hui
   le point de fragilité le plus sérieux de Hub4Fix : sans elle, le reste ne
   produit rien.
