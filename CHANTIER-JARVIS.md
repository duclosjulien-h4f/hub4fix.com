# Chantier Jarvis — journalisation, photos, identification

Jarvis est le « sélectionneur » du site : l'assistant qui accueille le client et
l'amène jusqu'à la bonne pièce. Ce chantier couvre quatre choses distinctes qu'il
ne fait pas encore — journaliser les demandes, accepter plusieurs photos, trier les
plaques, en extraire la donnée — et une qu'il fait mal : les photos trop lourdes sont
écartées en silence.

Statut : **à implémenter**, hors du pipeline de veille en cours de test.

---

## 1. État réel du code aujourd'hui

Contrairement à ce que supposait le briefing initial (§4 : « Jarvis journalise-t-il
les requêtes ? »), la réponse est tranchée en lisant `worker/api/ai-chat.js` :

| Question du briefing | Réponse |
|---|---|
| Jarvis journalise-t-il les requêtes sans réponse satisfaisante ? | **Non. Rien n'est journalisé.** |
| Où vivent ces logs ? | Ils n'existent pas. La table `ai_usage` (D1) ne stocke que `(bucket, ts)` pour le quota horaire — aucun contenu. |
| Format d'accès ? | Sans objet : il faut d'abord écrire la journalisation. |

Ce qui existe déjà et fonctionne :

- Modèle `@cf/google/gemma-4-26b-a4b-it` sur Workers AI — **vision incluse**, contexte 256K
- L'outil `chercher_piece` interroge le feed catalogue réel ; le garde-fou « ne jamais
  citer une pièce de mémoire » est en place et c'est le bon réflexe
- Les trois cas de réponse sont déjà distingués : `disponible` / `en cours d'acquisition` / non trouvée
- La consigne système invite déjà le client à photographier la plaque signalétique
- Quotas : 20 messages/h anonyme, 60 connecté

Buckets R2 déjà provisionnés : `h4f-pieces`, `h4f-masters`, `h4f-reservations`, `h4f-submissions`.

---

## 2. Bug à corriger en premier — les photos sont silencieusement jetées

`ai-chat.js` ligne 247 :

```js
if (typeof url === 'string' && url.startsWith('data:image/') && url.length <= MAX_IMAGE_B64) {
  parts.push({ type: 'image_url', image_url: { url } });
  images++;
}
```

`MAX_IMAGE_B64 = 1600000` caractères de base64, soit ~1,2 Mo décodé. Une photo prise
au téléphone pèse 3 à 5 Mo, ce qui donne 4 à 6,7 M de caractères en base64 — **3 à 4×
au-dessus du plafond.**

Quand le plafond est dépassé, la condition échoue et **rien n'est ajouté** : pas
d'erreur, pas de log, aucun retour au client. Jarvis répond comme si aucune photo
n'avait été envoyée. Le client, lui, croit l'avoir transmise.

**Correctif : redimensionner côté navigateur avant l'envoi.** Un `<canvas>` qui
réduit à 1600 px sur le grand côté et réencode en JPEG q80 donne ~200 Ko. Trois
bénéfices d'un coup :

- on repasse largement sous le plafond, la fonctionnalité marche enfin
- **l'EXIF est supprimé au réencodage** — donc les coordonnées GPS du domicile du
  client, que tout téléphone embarque par défaut, ne quittent jamais son appareil
- l'upload devient rapide depuis une cuisine en 4G

Et prévoir malgré tout un message clair si l'image reste trop lourde, au lieu du
silence actuel.

Autre limite à lever : `images < 1` n'autorise qu'**une seule** photo par message.
L'usage voulu en accepte plusieurs (l'appareil + la plaque + la pièce cassée).

---

## 3. Le parcours visé

```
Client arrive
     │
     ▼
Jarvis accueille et demande ce qu'il cherche
     │
     ├─── point de départ « vague »  ────┐   « ma cafetière fuit »
     │                                    │
     └─── point de départ « photos » ────┤   1 à N photos
                                          │
                                          ▼
                          Analyse vision → marque + modèle
                                          │
                                          ▼
                          chercher_piece (catalogue réel)
                                          │
                                          ▼
                     Liste des pièces existantes et faisables
```

Le point important : les deux entrées convergent vers le même appel catalogue. La
photo n'est pas une fonctionnalité à part, c'est juste un autre moyen d'obtenir
marque + modèle quand le client ne sait pas les lire.

---

## 4. Journalisation — toutes les demandes, même farfelues

**Décision : on recueille tout.** Une demande absurde aujourd'hui est un axe de
recherche a posteriori : elle dit ce que les gens cherchent et qu'on n'a pas.

À écrire — nouvelle table D1, distincte de `ai_usage` :

| Champ | Pourquoi |
|---|---|
| `ts` | horodatage |
| `session_hash` | identifiant de session **haché**, pour recoller les tours d'une même conversation sans identifier la personne |
| `demande_texte` | ce que le client a écrit, tel quel |
| `marque_extraite`, `modele_extrait` | ce que Jarvis a compris |
| `origine_identification` | `texte` \| `photo` \| `les deux` |
| `confiance` | l'identification était-elle sûre |
| `resultat` | `disponible` \| `en_cours_acquisition` \| `non_trouvee` \| `hors_sujet` |
| `nb_photos` | combien de photos reçues (pas les photos elles-mêmes) |
| `photo_conservee` | booléen, et pourquoi le cas échéant |

Les lignes `non_trouvee` sont la matière première : ce sont des pièces que des gens
cherchent et que le catalogue n'a pas. Elles entrent dans le vivier BU comme **source
de priorité 0**, avec le même traitement que les autres : statut `Brut`, puis
vérification indépendante avant toute promotion.

Volume : une ligne fait ~400 octets. À 50 demandes/jour, cela donne 20 Ko/jour,
soit **~7 Mo par an**. Le coût de « tout garder » en texte est négligeable.

---

## 5. Rétention des photos — la question du stockage

### L'asymétrie qui règle le problème

| | Par demande | 50/jour | Sur 1 an |
|---|---|---|---|
| Texte + faits extraits | ~400 o | 20 Ko | **~7 Mo** |
| Photos brutes (2 × 4 Mo) | ~8 Mo | 400 Mo | **~146 Go** |
| Photos redimensionnées (2 × 200 Ko) | ~400 Ko | 20 Mo | **~7 Go** |

Rapport de 1 à 20 000 entre le texte et les pixels bruts. Donc : **garder tout le
texte pour toujours, ne garder les photos que par exception.** Les deux objectifs
— « recueillir toutes les demandes » et « ne pas saturer le stockage » — ne
s'opposent pas dès qu'on sépare le texte des images.

### Le principe : la photo est un moyen, pas le livrable

Le client envoie une photo pour que Jarvis lise la plaque. Dès que la vision a
renvoyé « Moulinex Companion HF800 », la photo a fait son travail. Ce qui a de la
valeur durable, c'est la chaîne extraite — pas les pixels.

C'est exactement la règle déjà écrite dans le pipeline BU : *« jamais stocker le
texte brut des posts, seulement les faits extraits »*. Même principe, appliqué aux
images.

### La vraie raison de supprimer, et ce n'est pas la place

Sur R2, 7 Go coûtent environ **1,25 $ par an** (0,015 $/Go/mois, egress gratuit).
L'argent n'est pas la contrainte, même en gardant tout.

La contrainte est le **RGPD**. Une photo d'appareil est prise chez quelqu'un. Elle
embarque :

- des coordonnées GPS dans l'EXIF, c'est-à-dire l'adresse du domicile
- ce qui se trouvait dans le cadre : la pièce, des papiers, des personnes, un reflet

C'est une donnée personnelle. La conserver « au cas où » demande une base légale et
une durée de conservation définie. Supprimer par défaut n'est donc pas une
optimisation de disque, c'est ce qui réduit l'exposition — et c'est pour ça que la
suppression est le comportement normal et la conservation l'exception.

### Politique retenue — trois niveaux

> **Affinée en §6.** Le filtre retenu distingue les photos de *plaque signalétique*
> des autres, et l'extraction en CSV rend la conservation de l'image inutile dans le
> cas majoritaire. Lire §6 avant d'implémenter ce tableau.

| Cas | Rétention | Justification |
|---|---|---|
| **Identification réussie**, pièce déjà au catalogue | **Supprimée dès la réponse envoyée** | La photo n'a plus aucune valeur résiduelle. C'est le cas majoritaire. |
| **Identification échouée ou peu sûre** | **30 jours** | C'est le matériau pour corriger le prompt et pour une identification humaine. C'est aussi le seau « farfelu » qui révèle des axes de recherche. |
| **Pièce hors catalogue, candidate au vivier** | **Conservée, sur décision explicite** | Valeur R&D réelle : géométrie, fixations, cotes. Devient une pièce jointe de la fiche vivier, pas un fichier orphelin. |

Mise en œuvre : une **règle de cycle de vie R2** (`lifecycle rule`) sur un préfixe
dédié fait expirer les objets automatiquement. Aucun cron à écrire, aucune tâche de
ménage à surveiller — c'est R2 qui purge.

Conséquence de cette politique : le stockage **plafonne** au lieu de croître
linéairement. En régime stable, si ~15 % des demandes tombent dans le seau
« identification échouée » conservé 30 jours, on stationne autour de
15 × 2 × 200 Ko × 30 ≈ **180 Mo**, indéfiniment.

### Ce qui reste ouvert

- **Le seuil de confiance** qui fait basculer une photo de « supprimée » à
  « conservée ». Point de départ proposé : conserver si `champs_manquants` n'est pas
  vide, ou si `confiance_cle` < 0,8 — c'est-à-dire dès qu'on n'a pas lu la clé
  catalogue avec certitude. À ajuster sur les premiers vrais cas.
- **La durée de la fenêtre de litige.** 90 jours est un point de départ aligné sur le
  délai de réclamation courant, pas un résultat.

L'information du client, elle, est tranchée : voir §6.

---

## 6. Filtre « plaque signalétique » + extraction CSV

Affinement de §5. Le filtre pertinent n'est pas « photo / pas photo » mais
**« plaque signalétique / autre »** — parce que ces deux types d'images n'ont ni la
même valeur ni le même risque.

| | Photo de plaque | Photo d'appareil ou de pièce |
|---|---|---|
| Contenu | une étiquette industrielle, cadrée serré | une cuisine, un salon, ce qui traînait dans le cadre |
| Valeur durable | **élevée** : c'est la clé du catalogue pièces | faible une fois le modèle identifié |
| Exposition RGPD | **faible**, sauf le numéro de série | réelle : lieu de vie, personnes, documents |

Donc oui : filtrer sur la plaque et ne conserver que celles-là est plus défendable
que ma proposition initiale, sur les deux plans à la fois.

### Mais la vraie question : pourquoi garder les pixels si on a extrait la donnée ?

C'est le point à trancher avant d'écrire quoi que ce soit. **Une plaque correctement
lue n'a plus de valeur en tant qu'image** — la ligne CSV porte toute l'information,
pèse 1000 fois moins, et se requête. Garder les deux, c'est stocker deux fois la même
chose sous la forme la plus lourde et la plus risquée.

Trois cas seulement justifient de garder l'image, et ils sont étroits :

1. **Extraction incomplète ou douteuse** — un champ non lu, un reflet, une plaque
   usée. Là seulement, la photo contient ce que le CSV n'a pas. C'est aussi le
   matériau pour corriger le prompt d'extraction.
2. **Fenêtre de litige** — si un client conteste (« vous m'avez envoyé la mauvaise
   pièce »), la plaque qu'il a lui-même photographiée tranche. Besoin réel, mais qui
   justifie une durée courte, pas une conservation indéfinie.
3. **Constitution d'un corpus de référence**, plafonné — savoir où chaque fabricant
   place quoi sur son étiquette s'apprend sur des exemples. Mais la 51ᵉ plaque Bosch
   n'apprend rien de plus que les 50 premières : échantillonner par marque, ne pas
   tout garder.

### Le numéro de série — décision : décoder puis hacher

C'est le seul champ de la plaque qui pose vraiment problème. Un numéro de modèle
n'est pas une donnée personnelle — des millions de personnes possèdent un HF800. Un
**numéro de série identifie un objet unique chez une personne unique** ; recoupé avec
le journal des demandes (horodatage, session, éventuellement compte), il devient
identifiant.

Mais le hacher tout de suite détruirait une information dont on a besoin : le série
encode souvent **l'année et l'usine de fabrication**, et chez un vendeur de pièces la
variante décide de la compatibilité. Un même modèle commercial peut porter deux bols
ou deux charnières incompatibles selon l'année de production. Perdre ça, c'est
envoyer la mauvaise pièce à un client qui a pourtant donné la bonne référence.

**Décision retenue — dans cet ordre, à l'extraction :**

1. Lire le numéro de série
2. En **décoder** ce qui est décodable → colonnes `annee_fabrication`, `variante_usine`
3. **Hacher** le numéro de série
4. Ne jamais écrire le série en clair dans le CSV d'analyse

On garde la précision de variante sans conserver d'identifiant unique. En clair, le
série n'existe que là où c'est opérationnellement nécessaire — un litige, une
commande — et avec la durée de conservation du dossier concerné, pas celle du corpus.

Contrepartie assumée : **l'encodage du série est propre à chaque fabricant** et doit
s'établir marque par marque. Les champs porteurs sont connus (le `FD` chez BSH, les
premiers chiffres du série chez Electrolux, le code type chez SEB), mais la convention
exacte de décodage se vérifie sur de vraies plaques — c'est précisément ce que le
corpus échantillonné permet de faire.

### Conséquence non évidente du hash : il rend les comptages justes

Hacher le série n'est pas seulement de l'hygiène RGPD, c'est ce qui permet de
**compter des appareils distincts plutôt que des envois de photo**. Un client qui
photographie sa plaque trois fois de suite produit trois images mais un seul hash.
Sans ce champ, toute statistique de fréquence compterait des gestes d'upload ; avec
lui, elle compte des machines. C'est ce qui rend exploitable le signal de §6bis.

### Schéma CSV proposé

Un fichier distinct du vivier BU : ce n'est pas un signal de rareté, c'est une base
d'identification.

| Colonne | Contenu |
|---|---|
| `plaque_id` | identifiant de l'objet R2, ou son hash si la photo a été purgée |
| `ts` | date de captation |
| `marque` | normalisée |
| `modele_commercial` | ce que le client appelle son appareil |
| `cle_pieces` | **la référence qui ouvre le catalogue pièces** |
| `cle_pieces_type` | `e_nr` \| `pnc` \| `type_seb` \| `12nc` \| `model_code` |
| `serie_hash` | numéro de série **haché**, jamais en clair ici |
| `annee_fabrication` | décodée du FD ou du n° de série **avant** le hachage |
| `variante_usine` | code usine / révision décodé du série, quand il l'encode |
| `puissance_w`, `tension` | tels que lus |
| `categorie` | lave-linge, robot, cafetière… |
| `confiance_marque`, `confiance_cle` | par champ, pas globale : on lit souvent la marque avec certitude et la clé mal |
| `champs_manquants` | liste des champs non lus — c'est ce qui décide de garder la photo |
| `photo_conservee` | oui/non + motif parmi les trois cas ci-dessus |
| `demande_id` | lien vers la ligne de journalisation (§4) |

### La subtilité qui compte : la clé pièces dépend du fabricant

Le champ qui permet de retrouver une pièce **n'est pas le même selon la marque**, et
ce n'est presque jamais le nom commercial :

- **BSH** (Bosch, Siemens, Neff) : le `E-Nr` (Erzeugnisnummer), accompagné du `FD`
  (date de fabrication). C'est le E-Nr qui ouvre le catalogue, pas « SMI46KS01E » lu
  sur la façade.
- **Groupe SEB** (Moulinex, Krups, Tefal, Rowenta) : un code type sur la plaque, plus
  précis que la référence commerciale — « HF800 » désigne une famille, la plaque
  porte la variante exacte.
- **Electrolux, AEG** : le `PNC` (Product Number Code).
- **Whirlpool, Indesit** : un code `12 NC` ou un « Service Number ».

D'où les deux colonnes `cle_pieces` + `cle_pieces_type` plutôt qu'une colonne
normalisée unique (qui perdrait de quel système vient la valeur) ou une colonne par
fabricant (qui serait vide à 90 %).

**Cette liste est à compléter en observant les vraies plaques** — c'est précisément
l'usage du corpus échantillonné du cas 3.

### Coût de stockage, avec ce filtre

Une plaque cadrée serré, redimensionnée à 1600 px, pèse ~200 Ko. Si la moitié des
demandes avec photo comportent une plaque, à 50 demandes/jour :

| Politique | Volume | Coût R2 |
|---|---|---|
| Plaques gardées 90 jours (fenêtre litige) | ~450 Mo en régime stable | quelques centimes/an |
| Plaques gardées indéfiniment | ~1,8 Go/an cumulé | **moins d'1 €/an**, même après plusieurs années |

Autrement dit : sur le plan du stockage, garder toutes les plaques pour toujours est
sans effet sur le budget. **Ce n'est donc pas la place qui doit décider** — c'est le
numéro de série et la durée de conservation qu'on est capable de justifier.

### Transparence — décision : annoncé, et présenté comme un service

La conservation des plaques est **dite au client, dans l'interface**, pas seulement
enfouie dans les CGU.

La raison est stratégique autant qu'éthique : Hub4Fix parle à des gens qui se sentent
déjà lésés par des fabricants qui ne fournissent plus leurs pièces. Si
« Hub4Fix garde des photos de vos appareils » se découvre au lieu de s'annoncer,
c'est la découverte qui fait le sujet — pas la finalité, même irréprochable. Le coût
d'une annonce est de deux phrases ; le coût d'une révélation est la confiance.

Formulation du sens à donner, à écrire proprement le moment venu : *envoyer la plaque
permet d'identifier l'appareil plus vite, et sert au prochain client qui aura le même
modèle.* C'est vrai, c'est vérifiable, et ça transforme le corpus en argument.

Trois conséquences concrètes :

- Jarvis peut **demander explicitement** la plaque, au lieu de se contenter de la
  suggérer comme aujourd'hui
- Les CGU décrivent : ce qui est conservé, combien de temps, comment demander la
  suppression — et ces phrases doivent exister **avant** la première plaque conservée
- Le corpus cesse d'être un risque à gérer pour devenir une raison de participer

### Ce que ça devient

Au bout de quelques mois, ce CSV est une **table de correspondance
modèle → clé pièces**, construite sur des plaques réelles photographiées par des
clients réels. Aucun concurrent ne l'a, et elle ne s'achète pas : elle se constitue
en rendant service. C'est un actif au même titre que le vivier — et il tombe donc
sous la même règle que lui : **jamais dans le dépôt public.**

---

## 6bis. Le parc signalé — un signal de demande, hors de la grille 0-7

Si quarante personnes photographient la plaque du même lave-linge, ce n'est pas du
bruit : c'est du **parc installé mesuré chez des gens qui ont un problème**. C'est
sans doute un meilleur indicateur de demande que les posts de forum, parce qu'il est
mesuré sur des demandes réelles et non sur des plaintes publiques.

**Décision : ce signal existe, mais il reste hors de la grille de rareté.**

Le briefing pose la grille à sept critères comme une décision actée. En faire un
huitième critère casserait la notation « 0-7 » et rendrait incomparables tous les
scores déjà attribués. Le signal vit donc à côté, dans sa propre colonne :

| Champ | Définition |
|---|---|
| `parc_signale` | nombre de `serie_hash` **distincts** observés pour une même `cle_pieces` |
| `parc_fenetre` | période d'observation du comptage (glissante, ex. 90 jours) |

Deux propriétés à respecter :

- **Compter des appareils, pas des uploads** — d'où la dépendance au `serie_hash`
  décrite en §6. Sans lui, trois photos d'une même plaque compteraient trois fois.
- **Ne pas convertir en points.** Une fiche se présente avec son score de rareté
  *et* son parc signalé, côte à côte. Ce sont deux questions différentes : « cette
  pièce est-elle introuvable ? » et « combien de gens ont cet appareil ? ». Une pièce
  peut être très rare avec un parc minuscule — c'est justement le cas qu'il faut
  pouvoir distinguer, pas noyer dans un total.

Ce signal ne dispense de rien : une fiche remontée par le parc signalé entre en
statut `Brut` et passe la vérification indépendante comme toutes les autres.

---

## 7. Ordre de mise en œuvre suggéré

1. **Redimensionnement côté navigateur** + message d'erreur explicite (§2). Débloque
   la fonctionnalité photo, qui échoue silencieusement aujourd'hui, et supprime
   l'EXIF au passage. Le plus petit changement pour le plus gros effet.
2. **Lever la limite à une seule image** par message (§2).
3. **Table de journalisation** (§4). Indépendante du reste, et c'est elle qui ouvre
   la source de priorité 0 du vivier BU.
4. **Règle de cycle de vie R2** + rétention (§5, affinée par §6). À faire avant de
   conserver la première photo, pas après.
5. **Classification plaque / autre** à l'analyse vision (§6). C'est le filtre qui
   commande tout le reste : sans lui, on ne sait pas quelle photo mérite quoi.
6. **Extraction des champs de plaque vers CSV** (§6), avec confiance par champ, et
   série décodé **puis** haché (§6). La ligne CSV est le livrable ; la photo n'est
   conservée que si l'extraction est incomplète.
7. **Annonce dans l'interface + phrases CGU** (§6). À faire **avant** la première
   plaque conservée, pas après — c'est ce qui rend l'étape 6 publiable.
8. **Alimentation du vivier** depuis les lignes `non_trouvee`, avec entrée en statut
   `Brut` et vérification indépendante obligatoire comme toute autre source.
9. **Compteur `parc_signale`** (§6bis), une fois qu'il y a assez de plaques pour que
   le comptage veuille dire quelque chose. Dernier de la liste sans être le moins
   utile : c'est un agrégat, il se calcule quand la base existe.

Les étapes 5 et 6 sont indissociables : classifier sans extraire ne sert à rien,
extraire sans classifier revient à passer des photos de cuisine dans un lecteur de
plaques. Et l'étape 7 conditionne la mise en production des deux : le décodage du
série est du travail par marque, mais l'annonce au client est du travail à faire une
fois — et sans elle, rien de tout ça ne doit tourner.
