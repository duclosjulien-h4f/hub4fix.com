# Bascule vers Cloudflare Pages — pour rendre le dépôt privé

Objectif : **plus rien de public sauf le site lui-même.** Le dépôt de code
devient privé, hub4fix.com reste en ligne.

GitHub Pages ne sert pas les dépôts privés sur le plan gratuit — rendre le dépôt
privé aujourd'hui couperait le site. Cloudflare Pages les sert gratuitement, et
tout le reste de la pile est déjà chez Cloudflare : workers, D1, R2, DNS du
domaine. La bascule consolide au lieu d'ajouter un fournisseur.

---

## Ce qui est déjà prêt

- **`build-site.sh`** assemble `_site/` et **échoue** si un fichier sensible s'y
  trouve. C'est la source de vérité unique du périmètre publiable, utilisée par
  GitHub Actions comme par Cloudflare Pages — pour que changer d'hébergeur ne
  puisse pas réintroduire une fuite que l'autre avait bouchée.
- Le workflow GitHub Pages actuel appelle ce script au lieu de publier
  `hub4fix.com/` en vrac.
- `_site/` est dans `.gitignore`.

Le script a été testé sur cinq cas : état normal (passe), `.toml` oublié
(échoue), schéma SQL dans `data/` (échoue), `.dev.vars` (échoue), et code
serveur rangé sous un autre nom que `worker/` (échoue — c'est le cas qui
franchissait un contrôle par extension seul).

---

## Les étapes, dans l'ordre

L'ordre compte : le site doit tourner sur Cloudflare **avant** que le dépôt
devienne privé, sinon il y a une coupure.

### 1. Créer le projet Cloudflare Pages

Cloudflare → Workers & Pages → Create → Pages → Connect to Git → dépôt
`duclosjulien-h4f/hub4fix.com`.

Réglages de build :

| Champ | Valeur |
|---|---|
| Production branch | `main` |
| Build command | `./build-site.sh` |
| Build output directory | `_site` |
| Root directory | *(laisser vide — la racine du dépôt)* |

Rien d'autre. Pas de framework à sélectionner, pas de variable d'environnement.

### 2. Vérifier le déploiement d'essai

Cloudflare publie sur une adresse `*.pages.dev`. À contrôler avant de toucher au
DNS :

- la page d'accueil s'affiche, les styles et les images chargent
- `hotlist.html` liste bien les pièces (elle lit `data/hotlist.json`)
- **`<adresse>.pages.dev/worker/admin.js` renvoie 404** — c'est le test qui
  compte, il prouve que le filtrage a bien tourné chez Cloudflare
- `<adresse>.pages.dev/hotlist-admin.html` renvoie 404 aussi

Si le build a échoué, lire son journal : le garde-fou dit quel fichier l'a
arrêté et pourquoi.

### 3. Rattacher le domaine

Pages → le projet → Custom domains → `hub4fix.com` (et `www` si utilisé).
Le DNS étant déjà chez Cloudflare, le rattachement se fait sans manipulation
d'enregistrement.

Le fichier `hub4fix.com/CNAME`, qui servait à GitHub Pages, devient inutile.
Le laisser ne gêne pas — Cloudflare l'ignore.

### 4. Attendre que le domaine serve bien depuis Cloudflare

Vérifier `https://hub4fix.com` avant de continuer. C'est le point de
non-retour : tant que cette étape n'est pas concluante, ne pas passer à la
suivante.

### 5. Rendre le dépôt privé

GitHub → Settings → General → Danger Zone → Change visibility → Private.

Puis, dans Settings → Pages, désactiver GitHub Pages, et supprimer
`.github/workflows/deploy-pages.yml` du dépôt — deux hébergeurs qui publient le
même site finiraient par diverger.

### 6. Ne pas oublier : passer le dépôt en privé ne dé-publie rien

Tout ce qui a été commité pendant que le dépôt était public reste connu :
copies, forks, caches, archives. La visibilité protège **la suite**, pas le
passé.

C'est pourquoi la rotation du mot de passe `hub4fix_admin_2026` reste à faire —
voir `SECURITE.md`. Le rendre privé ne remplace pas ce changement.

---

## Ce qui ne change pas

Les workers ne sont pas concernés. Ils se déploient par `wrangler deploy` depuis
`hub4fix.com/worker/`, indépendamment de l'hébergement du site, et leurs secrets
vivent au dashboard. Rendre le dépôt privé ne change rien à leur fonctionnement.

## Si vous voulez revenir en arrière

Remettre le dépôt en public et réactiver GitHub Pages : le workflow est
conservé jusqu'à l'étape 5 précisément pour que le retour soit possible. Après
l'étape 5, il faut le restaurer depuis l'historique git.
