# Audit d'exposition — dépôt public et site déployé

Fait le 2026-09-06. Le dépôt `duclosjulien-h4f/hub4fix.com` est **public** (vérifié :
un `git ls-remote` sans aucune authentification aboutit). Tout ce qui y est commité
est lisible par n'importe qui, et le reste indéfiniment — l'historique git ne
s'oublie pas.

---

## Ce qui n'a jamais fuité

À dire d'abord, parce que c'est le plus important : **aucun secret cryptographique
n'a jamais été commité.** Recherche menée sur la totalité de l'historique, pas
seulement sur l'état courant :

| Cherché | Trouvé |
|---|---|
| `BEGIN PRIVATE KEY`, `BEGIN RSA` | aucun |
| Clés API Resend (`re_…`), OpenAI (`sk-…`), Google (`AIza…`), GitHub (`ghp_…`) | aucune |
| `.env`, `.dev.vars`, `.pem`, `.key`, comptes de service | jamais ajoutés, à aucun commit |

La discipline `wrangler secret put` + `.gitignore` a tenu. `SESSION_SECRET`,
`GOOGLE_SA_KEY`, `PIPELINE_TOKEN`, `SLICER_SECRET` n'ont jamais quitté le dashboard
Cloudflare.

---

## Ce qui était exposé, et qui est corrigé

### 1. Tout le back-office était servi sur le domaine de production

`deploy-pages.yml` publiait le dossier `hub4fix.com/` tel quel. Or ce dossier
contient `worker/`. Étaient donc téléchargeables sur **hub4fix.com/worker/…** :

- `admin.js` — 200 Ko : toutes les routes, le flux d'authentification, les
  contrôles de rôle, la logique de session
- les cinq schémas `.sql` — structure complète des bases
- les trois `wrangler.toml` — identifiants de bases D1, noms de buckets R2, et la
  liste nominative des secrets à chercher

Aucun de ces éléments n'est un mot de passe, mais ensemble ils forment la carte du
système : de quoi chercher une faiblesse sans tâtonner.

**Corrigé** : le workflow assemble maintenant un dossier `_site/` ne contenant que
ce qu'un navigateur doit lire, et **échoue** s'il y reste un `.toml`, un `.sql`, un
`.pem` ou un `.key`. Un garde-fou plutôt qu'une bonne intention : une régression
silencieuse remettrait le back-office en ligne sans que personne le remarque.

`src/` est délibérément conservé — ce n'est pas sensible (l'équivalent compilé est
public de toute façon) et `app.html` y renvoie encore.

### 2. Un mot de passe en clair dans deux pages servies

`hotlist-admin.html` et `admin-demo.html` contenaient
`ADMIN_PASSWORD = 'hub4fix_admin_2026'`, en clair, côté client.

Un mot de passe écrit dans une page servie au navigateur est lisible en affichant
la source. Ce n'était pas une protection, seulement son apparence — et ces deux
pages sont référencées par **aucune** autre page du site.

**Corrigé** : le littéral est retiré des deux fichiers, la porte factice est
supprimée (plutôt que laissée avec une serrure ouverte, ce qui entretiendrait
l'illusion), et les deux pages sont exclues du déploiement. Leurs données vivent
dans le `localStorage` du navigateur qui les ouvre : il n'y a rien à y protéger.

### 3. L'e-mail de l'administrateur dans un fichier public

`worker/partner/wrangler.toml` portait `ADMIN_EMAILS = "duclosjulien@gmail.com"`.
Publier la liste blanche des comptes admin, c'est publier la liste des comptes à
attaquer — et c'est une donnée personnelle.

**Corrigé** : la valeur est retirée du dépôt, à poser au dashboard Cloudflare. Le
worker lit `String(env.ADMIN_EMAILS || '')` : en son absence la liste est vide et
la commande de test est refusée. Comportement fermé par défaut, donc sans risque
d'ouverture accidentelle.

---

## Ce que le code ne peut pas réparer — à faire de votre côté

### Faire tourner le mot de passe `hub4fix_admin_2026`

Le retirer du dépôt ne le dé-publie pas : il est dans l'historique git depuis le
commit `ca2aca1`, sur un dépôt public. **Il doit être considéré comme connu de
tous, définitivement.**

Si cette chaîne — ou une variante — sert ailleurs (autre outil, autre compte,
schéma de mot de passe réutilisé), c'est là qu'est le vrai risque, pas dans les
deux pages orphelines. À changer partout où elle a servi.

Réécrire l'historique (`git filter-repo`) est possible mais ne rattraperait rien :
le dépôt est public depuis des mois, les forks et les caches existent. La rotation
est la seule mesure qui referme quelque chose.

### Poser `ADMIN_EMAILS` au dashboard

Cloudflare → Workers → `h4f-partner` → Variables, ou
`npx wrangler secret put ADMIN_EMAILS`. Sans elle, la création de commande de test
reste refusée — c'est sans danger, mais la fonction ne marchera pas.

### Vérifier ce qui a déjà été indexé

`hub4fix.com/worker/admin.js` a pu être exploré par des moteurs ou archivé. Une
fois le déploiement corrigé, l'URL renverra 404, mais les copies déjà prises
subsistent. À vérifier sur `web.archive.org` et via une recherche
`site:hub4fix.com worker` — et à demander en retrait le cas échéant.

---

## Connu, laissé en place, et pourquoi

**Les identifiants de bases D1** (`02cfcaa2…`, `c3c71c6a…`, `d3f3a9a5…`) restent
dans les `wrangler.toml`. Ce ne sont pas des identifiants d'accès : sans
authentification au compte Cloudflare, on ne fait rien avec. `wrangler deploy` en a
besoin au moment du déploiement, et les retirer casserait la publication pour un
gain nul. Ils ne sont plus servis sur le domaine — seulement présents dans le dépôt.

**Les noms des secrets**, en commentaire dans les `wrangler.toml`. Ils documentent
utilement ce qu'il faut configurer, et connaître le nom d'un secret ne donne pas sa
valeur. Plus servis sur le domaine non plus.

**L'`ISSUER` et le `CLIENT_ID` Zitadel**, dans `auth-callback.html` et
`js/zitadel-client.js` — et ils y restent nécessairement. Le navigateur doit les
connaître pour lancer la redirection vers le fournisseur d'identité : c'est le
principe d'un client OIDC public. Ce n'est pas une fuite, c'est le protocole.
Ce qui doit rester secret, c'est `SESSION_SECRET`, et il n'a jamais été dans le dépôt.

**Les URL `*.workers.dev`** appelées depuis `index.html`, `produit.html` et
`produits.html`. Le front doit connaître l'adresse de son API. À noter cependant :
`worker/api/wrangler.toml` prévoit de mapper ce worker sur `api.hub4fix.com` pour
obtenir un cookie de première partie. Tant que le front tape `*.workers.dev`, le
cookie de session est tiers et les navigateurs le bloquent de plus en plus. C'est
une gêne fonctionnelle à venir, pas un problème de sécurité.

---

## Règle à retenir

`hub4fix.com/` est le dossier **publié**. Tout fichier qu'on y dépose devient
public au prochain déploiement sur `main`. Le code serveur, les schémas, les
configurations et les outils n'y ont pas leur place — et le garde-fou du workflow
fait maintenant échouer le build plutôt que de les publier.
