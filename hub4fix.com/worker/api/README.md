# Déploiement — worker `h4f-api` (auth B2C + bibliothèque + tokens)

Auth maison sur **D1** (base `h4f_site`). Mots de passe PBKDF2, session = cookie httpOnly signé HMAC.
Endpoints : `POST /auth/signup` · `POST /auth/login` · `GET /auth/me` · `POST /auth/profile` · `POST /auth/logout`.

Toutes les commandes se lancent **depuis `hub4fix.com/worker/api/`**.

---

## 1. Créer la base D1

```bash
npx wrangler d1 create h4f_site
```
Copie le `database_id` renvoyé dans **`wrangler.toml`** (remplace `REMPLACER_PAR_L_ID_RENVOYE_PAR_d1_create`).

## 2. Appliquer le schéma

```bash
npx wrangler d1 execute h4f_site --remote --file ../site-schema.sql
```
Crée `users` (+ colonnes mot de passe/profil), `token_ledger`, `purchases`, `orders`, etc.

## 3. Poser le secret de session

```bash
npx wrangler secret put SESSION_SECRET
```
Colle une chaîne aléatoire longue (32+ caractères). Ex. pour en générer une :
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

## 4. Déployer

```bash
npx wrangler deploy
```

## 5. ⚠️ Cookie 1re partie — `api.hub4fix.com` (indispensable)

Le cookie de session n'est envoyé par le navigateur que si le worker est sur le **même domaine parent** que le front.

- Dans le dashboard Cloudflare > worker `h4f-api` > **Custom Domains** : ajouter **`api.hub4fix.com`**.
- Le front DOIT être servi sur **`https://hub4fix.com`** (pas `duclosjulien-h4f.github.io`) : le cookie a `Domain=.hub4fix.com`, il n'est partagé qu'entre `hub4fix.com` et `api.hub4fix.com`.
- `COOKIE_DOMAIN` est déjà réglé sur `.hub4fix.com` dans `wrangler.toml`.

Côté front, `AUTH_ORIGIN` vaut déjà `https://api.hub4fix.com` (`js/account-menu-b2c.js`). **Rien à changer** si tu gardes ce domaine ; sinon adapte-le.

---

## 6. Vérification post-déploiement

```bash
# Inscription (pose un cookie de session dans cookies.txt)
curl -si -c cookies.txt -X POST https://api.hub4fix.com/auth/signup \
  -H "Content-Type: application/json" -H "Origin: https://hub4fix.com" \
  -d '{"email":"test@hub4fix.com","password":"motdepasse123"}'
# -> 201, JSON {email, prenom, tokens:5, ...} + en-tête Set-Cookie

# Session (réutilise le cookie)
curl -s -b cookies.txt https://api.hub4fix.com/auth/me -H "Origin: https://hub4fix.com"
# -> {"authenticated":true, "tokens":5, ...}
```
Puis, sur **https://hub4fix.com/kintsugi.html**, « Mon compte » : inscription/connexion réelles, profil, bibliothèque.

## Pièges fréquents
- **Login qui ne « tient » pas** = cookie tiers bloqué → vérifier `api.hub4fix.com` + front sur `hub4fix.com`.
- **CORS bloqué** = l'origine du front doit être dans `ALLOWED_ORIGINS` (`api.js`) — déjà : hub4fix.com, www, github.io, localhost.
- **`database_id` oublié** dans `wrangler.toml` → le worker déploie mais échoue à la 1re requête D1.

## Reste à faire (non bloquant ce soir)
- Photo de profil : upload vers R2 (`avatar_key` déjà en base, canal upload à ajouter).
- `POST /auth/reset` (mot de passe oublié).
- Pseudo unique quand le repartage communautaire arrivera.
