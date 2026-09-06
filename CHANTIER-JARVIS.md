# Chantier Jarvis — journalisation, photos, identification

Jarvis est le « sélectionneur » du site : l'assistant qui accueille le client et
l'amène jusqu'à la bonne pièce. Ce chantier couvre trois choses distinctes qu'il
ne fait pas encore, et une qu'il fait mal.

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

### Ce qui reste à trancher avec Julien

- **Le seuil de confiance** qui fait basculer une photo de « supprimée » à
  « conservée 30 jours ». Trop bas, on ne garde rien d'utile ; trop haut, on garde
  presque tout.
- **L'information du client.** Deux phrases dans les CGU suffisent, mais elles
  doivent exister avant le premier upload conservé : ce qui est gardé, combien de
  temps, et comment demander la suppression.
- **30 jours est-il le bon délai ?** C'est un point de départ, pas un résultat.

---

## 6. Ordre de mise en œuvre suggéré

1. **Redimensionnement côté navigateur** + message d'erreur explicite (§2). Débloque
   la fonctionnalité photo, qui échoue silencieusement aujourd'hui, et supprime
   l'EXIF au passage. Le plus petit changement pour le plus gros effet.
2. **Lever la limite à une seule image** par message (§2).
3. **Table de journalisation** (§4). Indépendante du reste, et c'est elle qui ouvre
   la source de priorité 0 du vivier BU.
4. **Règle de cycle de vie R2** + les trois niveaux de rétention (§5). À faire avant
   de conserver la première photo, pas après.
5. **Alimentation du vivier** depuis les lignes `non_trouvee`, avec entrée en statut
   `Brut` et vérification indépendante obligatoire comme toute autre source.
