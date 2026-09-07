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

## Mode de casse 3 — Clip qui casse à sa racine

**Symptôme.** Le bras d'encliquetage rompt net à son encastrement, là où il
sort de la pièce.

**Pourquoi.** Un bras de clip classique est une console en porte-à-faux : il
travaille en flexion, et toute la déformation se concentre à sa racine. Sur un
angle vif, c'est une concentration de contrainte — exactement la géométrie qui
amorce une rupture.

**Stratégie : ajouter des contreforts d'appui derrière le bras du clip.**

Le bras ne reste plus suspendu dans le vide : il vient buter contre un
contrefort. La charge se reprend alors **en compression** dans le contrefort au
lieu de rester en flexion sur la racine. Le dépôt de filament encaisse
beaucoup mieux la compression qu'une flexion sur angle vif, où il délamine.

Le principe est le même que pour les deux modes précédents : on ne renforce pas
la pièce en l'épaississant, on **change la nature de l'effort** pour l'orienter
vers ce que la technique sait supporter.

`À REMPLIR : jeu à laisser entre le bras et son contrefort — trop serré, le
clip ne fléchit plus assez pour s'encliqueter`

---

## Mode de casse 4 — Surface cylindrique qui tourne ou coulisse

Concerne les axes, pivots, paliers et glissières. Ce n'est pas une casse mais
une usure, et elle est propre à l'impression.

**Le problème.** Chaque couche a un point de départ et d'arrêt sur son
périmètre. Ces points s'empilent en une ligne verticale — la couture Z, la
« cicatrice ». Ce n'est pas qu'un défaut d'aspect : c'est un **bourrelet en
relief** sur toute la hauteur. Sur une surface qui tourne dans un alésage, elle
donne un point dur une fois par tour, et une usure prématurée localisée.

**Stratégie : creuser une gorge longitudinale et y loger la cicatrice.**

La couture passe en retrait de la surface portante. La surface de rotation
reste continue et le défaut se retrouve dans un creux où il ne frotte plus.

Un effet secondaire utile : la gorge crée un angle rentrant vif, et les
trancheurs en mode couture « alignée » choisissent justement les coins concaves
pour y placer le départ de couche. La gorge n'attend donc pas un réglage
particulier — elle attire la cicatrice.

**Confirmé en pratique** : le trancheur choisit de lui-même le fond de la gorge.
Aucun réglage de position de couture à imposer.

---

## Lire la pièce d'origine : fonction contre compromis de fabrication

Ceci n'est pas un mode de casse, c'est une méthode de lecture — et elle
commande tout le reste.

La pièce cassée qu'on a devant soi contient **deux choses mélangées** :

1. **Sa fonction** — ce qu'elle doit faire, ce qu'elle tient, où elle s'emboîte.
   Ça, on le garde intégralement.
2. **Les compromis de l'injection** — les formes qui n'existent que parce qu'il
   a fallu la mouler. Ça, on le jette.

Recopier un compromis, c'est reprendre la solution à un problème qu'on n'a pas.

### Le cas type : évidement à nervures

En injection, on ne peut pas faire une section épaisse et pleine : elle donne
des retassures en surface et allonge le refroidissement. Le dessinateur évide
donc la masse et ajoute des **nervures** pour retrouver de la raideur avec des
parois minces.

En dépôt de filament, cet évidement est contre-productif. Il multiplie les
parois, les petits détails et les déplacements à vide. Alors qu'un volume
**plein** imprimé à remplissage partiel est plus rapide, souvent plus solide, et
surtout : **le remplissage est déjà une nervure**, en gyroïde ou en grille,
générée automatiquement et répartie dans tout le volume au lieu d'être
concentrée sur quelques raidisseurs.

**La nervure devient interne, et gratuite.**

Donc : sur une pièce reprise d'un original injecté, **supprimer les évidements
et leurs nervures, laisser le plein, régler le remplissage.**

`À REMPLIR : à partir de quelle taille de pièce cette règle s'inverse — sur un
gros volume, le plein coûte du temps et du filament, et l'évidement redevient
justifié. Quel seuil en pratique ?`

### Les autres compromis à repérer

Même raisonnement, à documenter au fil des pièces :

`À REMPLIR : angles de démoulage inutiles, épaisseur de paroi uniforme imposée
par le moulage, absence de contre-dépouille — que faire de chacun`

---

## Le fil commun aux quatre modes

Aucune de ces stratégies ne consiste à mettre plus de matière. Chacune
**réoriente l'effort** vers ce que le dépôt de filament sait encaisser :

| Mode | Effort d'origine | Après correction |
|---|---|---|
| Téton cisaillé | cisaillement entre couches | traction dans la couche |
| Clip fatigué | flexion concentrée | flexion répartie sur une spirale |
| Clip à la racine | flexion sur angle vif | compression dans un contrefort |
| Surface tournante | frottement sur un bourrelet | défaut logé hors de la portée |

C'est la règle à retenir avant toute autre : **épaissir est le dernier recours,
réorienter est le premier réflexe.**

---

## La pièce-école : moyeu de roue d'aspirateur

Une seule pièce porte cinq décisions distinctes. C'est celle à montrer à un
modélisateur pour qu'il comprenne la doctrine sans lire le guide en entier.

*(Le dessin lui-même n'est pas versionné : ce dépôt est public. Seule
l'anatomie est décrite ici.)*

| Élément | Rôle | Renvoi |
|---|---|---|
| **Gorge longitudinale sur l'axe** | loge la couture Z hors de la surface portante — pas de point dur au tour | mode 4 |
| **Surface cylindrique de l'axe** | la portée de rotation, à garder continue et lisse | mode 4 |
| **Couronne en spirale au sommet** | flexion répartie sur la longueur des bras incurvés au lieu d'un pli unique | mode 2 |
| **Découpes de dégagement** | ce qui permet aux tétons de fléchir : sans elles, la spirale ne sert à rien | mode 2 |
| **Contreforts d'appui** | le bras bute au lieu de rester en porte-à-faux — la flexion devient compression | mode 3 |

Le point à ne pas manquer : **les découpes et les contreforts vont par paires.**
Les découpes donnent la souplesse, les contreforts en limitent la course. L'un
sans l'autre ne tient pas — trop de liberté et le bras casse par fatigue, pas
assez et il ne s'encliquette plus.

`À REMPLIR : la course laissée aux tétons — de combien fléchissent-ils avant de
toucher le contrefort ?`

---

## Modes de casse à documenter

Chacun attend la technique correspondante. Rien n'est écrit ici à la place de
Julien.

Les axes, pivots et surfaces de glissement sont traités au mode 4.

| Mode de casse | Stratégie |
|---|---|
| Filetage arraché | `À REMPLIR` |
| Dents d'engrenage cassées | `À REMPLIR` |
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
