# Ménage du dépôt — inventaire des fichiers obsolètes

> Document de **classement**, pas de suppression. Rien n'a été supprimé ni déplacé.
> Chaque entrée indique ce qui la rend obsolète, ce qui pointe encore dessus, et
> le geste à faire avant de la retirer.
>
> Établi le 2026-08-22 sur la branche `claude/cleanup-obsolete-docs-op9l6p`.

## Méthode

- Graphe des liens reconstruit sur `*.html`, `*.js`, `*.css`, `*.tsx`, `*.json`, `*.toml`, `*.md`
  (qui référence quoi, dans les deux sens).
- Croisé avec la date du dernier commit touchant réellement le fichier.
  Le dépôt démarre au commit `c787ac0` (2026-07-09) ; **un fichier encore figé à
  cette date n'a pas bougé depuis la création du dépôt**, alors que le reste du
  site a été retravaillé jusqu'au 2026-08-14.
- Recoupé avec ce que le workflow déploie réellement :
  `.github/workflows/deploy-pages.yml` publie **uniquement `hub4fix.com/`**.
  Tout ce qui vit à la racine du dépôt n'est jamais servi.

---

## Catégorie A — Suppression sans risque

Aucun lien entrant, **et hors du périmètre publié** (`.github/workflows/deploy-pages.yml`
n'envoie que `hub4fix.com/`, donc rien de ce qui suit n'existe en ligne). ~1,2 Mo.

| Fichier | Poids | Pourquoi |
|---|---|---|
| `logo hub4fix_v1_2025-Sep-07_03-01-05PM-000_CustomizedView22696223382.png` | 976 Ko | Export brut de modeleur 3D à la racine. Jamais référencé. Hors périmètre de déploiement. À elle seule, 70 % du poids listé ici. |
| `logo-hub4fix_v1_2025.ico` | 136 Ko | Ancien favicon racine. Remplacé par `hub4fix.com/favicon.ico` + `favicon.svg` (utilisés par 28 pages). Jamais référencé. |
| `logo H4F.png` | 12 Ko | Idem, doublon d'époque du logo. Le logo vivant est `hub4fix.com/images/logo-h4f.svg`. |
| `demo-hub4fix/index.html` | 80 Ko | **Ancienne démo.** Maquette « Catalogue de pièces détachées » autonome, à la racine donc jamais déployée. 1 seul commit, figé au 2026-07-09. Ses seuls liens sortants sont `#` et `hub4fix_econologique.html`. Remplacée par `produit.html` / `test-marchand.html`. Le dossier entier part avec. |

**Commande** (à lancer quand la décision est prise) :

```bash
git rm "logo hub4fix_v1_2025-Sep-07_03-01-05PM-000_CustomizedView22696223382.png" \
       "logo-hub4fix_v1_2025.ico" \
       "logo H4F.png"
git rm -r demo-hub4fix
```

---

## Catégorie B — L'ancienne démo commerciale (3 fichiers solidaires)

Système de démonstration prospect complet, bâti sur la clé `localStorage.demoSession` :
`admin-demo.html` génère une session → `demo-login.html` la rejoue → `demo-bibliotheque.html` l'affiche.

Les trois pages sont **en ligne** (tout `hub4fix.com/` est publié) : les retirer
supprime donc trois URL réellement accessibles, pas seulement des fichiers morts.

**Cette clé n'existe nulle part ailleurs dans le dépôt.** Le « mode démo » actuel du
site est un mécanisme *différent* et plus récent, bâti sur la clé `h4f_demo`
(`js/account-menu.js`, `lancement.html`, `mon-compte.html`, `auth-callback.html`,
`hub4fix_econologique.html`, `test-comptes.html`). Les trois fichiers ci-dessous
sont donc la génération précédente, laissée en place.

| Fichier | Poids | Liens entrants | Dernier commit |
|---|---|---|---|
| `hub4fix.com/admin-demo.html` | 20 Ko | **aucun** | 2026-07-09 (init) |
| `hub4fix.com/demo-bibliotheque.html` | 36 Ko | `demo-login.html` seulement | 2026-07-09 (init) |
| `hub4fix.com/demo-login.html` | 16 Ko | `demo-bibliotheque.html`, `admin-demo.html`, **et `js/nav-mindmap.js`** | 2026-07-09 (init) |

### ⚠️ Le point de blocage

`js/nav-mindmap.js:103` fabrique le bouton **« Déconnexion »** de la barre de
navigation avec `href="demo-login.html"`. Ce script est chargé par **10 pages
vivantes** : `index`, `produit`, `printer`, `modelisateur`, `hotlist`,
`hotlist-admin`, `fiche-piece`, `repair-together`, `mon-compte`, `test-marchand`.

Supprimer `demo-login.html` en l'état ⇒ **404 sur la déconnexion de tout le site**.

**Geste préalable** : rebrancher cette cible sur la vraie page de sortie
(`index.html`, ou la déconnexion réelle de `js/account-menu.js`), puis vérifier
que plus rien ne cite `demo-login.html` :

```bash
grep -rn "demo-login\|demoSession" hub4fix.com/   # doit ne plus rien sortir
git rm hub4fix.com/admin-demo.html hub4fix.com/demo-bibliotheque.html hub4fix.com/demo-login.html
```

`favicon-admin.svg` reste utilisé par `hotlist-admin.html` et `worker/admin.js` — **à garder**.

**Au passage** : `admin-demo.html:171` contient `const ADMIN_PASSWORD = 'hub4fix_admin_2026';`
en clair dans le JS de la page, publiée publiquement. La garde ne protège qu'un
générateur de session de démo (impact limité), mais si ce mot de passe a été
réutilisé ailleurs, sa suppression est une raison de plus d'avancer — et de le
changer là où il sert encore.

---

## Catégorie C — Doublons à arbitrer (décision produit, pas technique)

| Fichier | Poids | Situation |
|---|---|---|
| `hub4fix.com/econologique-v2.html` | 439 o | Page de **redirection pure** (`meta refresh` + `location.replace`) vers `hub4fix_econologique.html`. Zéro contenu propre. Utile seulement si l'ancienne URL circule encore (liens externes, référencement). Sinon : doublon mort. **À supprimer si l'URL `econologique-v2.html` n'a jamais été diffusée.** |
| `hub4fix.com/worker/partner.js` | 16 Ko | **Ancien worker `h4f-partenaire`** (auth Zitadel + Google Sheet). Superseded par `worker/partner/partner.js`, le worker `h4f-partner` (D1 + pont B2C, 2026-08-10). **Aucun `wrangler.toml` ne pointe dessus** : `worker/wrangler.toml` → `admin.js`, `worker/partner/wrangler.toml` → `partner/partner.js`. Non déployable en l'état depuis le dépôt. MAIS `js/account-menu.js:17` envoie encore les partenaires vers `https://h4f-partenaire.duclosjulien.workers.dev` — l'ancien worker semble donc **toujours en ligne**. À supprimer une fois la bascule vers `h4f-partner` faite côté front. |
| `CNAME` (racine) | 11 o | Doublon exact de `hub4fix.com/CNAME`. Le workflow n'envoie que `hub4fix.com/`, donc **seul le second est lu** par GitHub Pages. Celui de la racine est un reliquat de l'époque où Pages servait la racine. À confirmer d'un coup d'œil aux réglages Pages avant retrait. |
| `hub4fix.com/jarvis-demo.html` | 40 Ko | **En ligne** sur `hub4fix.com/jarvis-demo.html` — tout `hub4fix.com/` est publié, sans exclusion. Maquette scriptée (tableau `SCRIPT` joué au `setTimeout`, **zéro appel réseau**), face à `jarvis.html` qui est la vraie page et appelle `/ai/chat` sur le worker `h4f-api`. Elle se déclare « jetable » en en-tête, mais elle date du **même commit que la vraie page** (`d6cfe72`, 2026-08-10, « … et maquettes ») : ce n'est pas un résidu ancien. Aucune page ne la lie — comme `jarvis.html` d'ailleurs : les deux ne se visitent que par URL directe. **La question est donc : cette URL a-t-elle été partagée à quelqu'un ?** Si non, suppression franche. Si oui, elle sert encore de vitrine sans back-end. |
| `hub4fix.com/favicon-partner.svg` | 807 o | Ajouté le 2026-08-07 avec `worker/partner/bridge.js`, **cité nulle part** dans tout le dépôt (ni HTML, ni JS, ni `app-page.js`). Soit un oubli de branchement dans la SPA partenaire, soit un orphelin. À trancher avec l'intention d'origine. |

---

## Catégorie D — Faux positifs (0 lien entrant mais **à garder**)

Repérés par l'analyse, écartés après vérification. Notés ici pour éviter qu'un
prochain ménage ne les supprime par erreur.

| Fichier | Pourquoi le garder |
|---|---|
| `hub4fix.com/app.html` | Point d'entrée du build Vite : `vite.config.ts` le déclare en `rollupOptions.input` et `server.open`. Aucun lien HTML ne pointe dessus par construction. |
| `hub4fix.com/src/**`, `tests/**`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts` | Socle React/Vite en cours (« Phase 1 — React + Vite », 2026-08-10). Chantier actif, pas un résidu. |
| `hub4fix.com/lancement.html` | Landing de campagne autonome (`noindex`, pose `h4f_demo=1`), diffusée par URL directe — d'où l'absence de lien entrant. Retravaillée le 2026-08-08. |
| `hub4fix.com/jarvis.html` | Vraie page assistant, en ligne et fonctionnelle : appelle `POST /ai/chat` sur `h4f-api` (route présente dans `worker/api/api.js:365`). `noindex` en attendant l'ouverture publique, d'où l'absence de lien entrant. |
| `hub4fix.com/test-marchand.html` | Malgré son nom : **démo publique vivante**, liée depuis `index.html:745` et cible de la barre de recherche (`index.html:978`). Multilingue FR/EN/DE/ES/IT. |
| `hub4fix.com/worker/collect-email.js` | Pas de `wrangler.toml`, mais le worker `h4f-collect` est **bien en production** : appelé par `auth-callback.html`, `mon-compte.html`, `js/collect-email.js`, `test-comptes.html`, `tools/generate-test-partners.mjs`. |
| `hub4fix.com/tools/*.mjs` | Les 4 outils servent (prévisualisation V2, mock partenaire, comptes de test, audio CGV). |
| `hub4fix.com/.gitignore` | Complète celui de la racine (portée Node locale). Pas un doublon. |

---

## Hors périmètre — deux anomalies relevées en chemin

Ni obsolètes ni en doublon, mais trouvées pendant l'inventaire.

1. **Référence cassée.** `hub4fix.com/images/favicon-h4f.svg` n'existe pas, alors que
   `jarvis.html:9` et `jarvis-demo.html` le déclarent en `<link rel="icon">`.
   Seule référence d'asset cassée de tout le site (vérifié sur `images/`, `css/`,
   `js/`, `data/`). Les deux pages étant publiées, l'onglet tombe sur le favicon
   par défaut dans les deux cas. À rebrancher sur `favicon.svg`.

2. **`hub4fix.com/test-comptes.html` est déployé publiquement.** La page est en
   `noindex` et se dit « privée », mais elle est servie sans authentification sur
   `hub4fix.com/test-comptes.html`. Elle permet à quiconque connaît l'URL de créer
   des comptes clients via `POST /client-seed`, de s'y connecter par usurpation, et
   de déclencher la suppression en masse des comptes test. À sortir du déploiement
   (ou à passer derrière la même garde que l'admin) — c'est un sujet séparé de ce
   ménage.

---

## Récapitulatif

| Catégorie | Fichiers | Poids | Action |
|---|---|---|---|
| A — sans risque | 4 (dont 1 dossier) | ~1,2 Mo | supprimable tel quel |
| B — ancienne démo | 3 | 72 Ko | **corriger `js/nav-mindmap.js:103` d'abord** |
| C — à arbitrer | 5 | ~58 Ko | décision produit requise |
| D — faux positifs | 8 entrées | — | ne pas toucher |
