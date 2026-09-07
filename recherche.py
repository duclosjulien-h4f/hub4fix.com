#!/usr/bin/env python3
"""
Hub4Fix — poste de recherche et de vérification.

    python recherche.py

Ouvre un navigateur sur http://127.0.0.1:8420. À gauche, la même navigation
que l'interface d'administration. Au centre, la liste en attente lue depuis
hotlist.json. À droite, la recherche : elle interroge réellement les sites de
pièces et rapporte ce qu'elle trouve.

Pourquoi un serveur local et pas une simple page HTML : une page web ne peut
pas interroger spareka.fr depuis le navigateur (blocage CORS du côté des sites
consultés). Un serveur local, lui, va chercher les pages lui-même et n'a pas
cette limite. Il tourne sur votre machine, donc il a Internet — contrairement
à l'environnement Claude Code.

Aucune dépendance : bibliothèque standard uniquement.
"""

import json
import re
import sys
import threading
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote_plus, urlparse
from urllib.request import Request, urlopen

RACINE = Path(__file__).resolve().parent
HOTLIST = RACINE / "hub4fix.com" / "data" / "hotlist.json"
VERDICTS = RACINE / "recherche-verdicts.json"

PORT = 8420
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " \
     "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"

# Sites interrogés. `q` reçoit la référence ou le nom de la pièce.
SITES = [
    {"cle": "spareka", "nom": "Spareka",
     "url": "https://www.spareka.fr/recherche?q={q}"},
    {"cle": "sos", "nom": "SOS Accessoire",
     "url": "https://www.sos-accessoire.com/catalogsearch/result/?q={q}"},
    {"cle": "fixpart", "nom": "FixPart",
     "url": "https://www.fixpart.fr/fr/recherche?q={q}"},
    {"cle": "google", "nom": "Recherche web",
     "url": "https://duckduckgo.com/html/?q={q}"},
]

# Indices lus dans la page rapportée. Ils ne remplacent pas votre jugement :
# ils disent où regarder, vous tranchez en ouvrant la page.
MOTS_RUPTURE = ["rupture", "épuisé", "epuise", "indisponible", "hors stock",
                "non disponible", "plus disponible", "article retiré",
                "produit introuvable", "aucun résultat", "aucun produit"]
MOTS_DISPO = ["en stock", "disponible", "ajouter au panier", "expédié",
              "livraison sous", "add to cart"]
RE_PRIX = re.compile(r"(\d{1,4}[.,]\d{2})\s*(?:€|EUR)", re.I)

STATUTS = ["to-validate", "verify-original", "regenerate", "published", "rejected"]

NAV = [
    ("Tableau de bord", False), ("Inscriptions", False),
    ("Shadow List", True), ("Candidatures partenaire", False),
    ("Réservations", False), ("Dépôt interne", False),
    ("Modèles 3D", False), ("Administrateurs", False),
    ("Appareils", False), ("Comptabilité", False),
    ("Journal d'audit", False),
]


# --------------------------------------------------------------------------- données
def charger_pieces():
    if not HOTLIST.exists():
        return {"erreur": f"hotlist.json introuvable : {HOTLIST}", "pieces": []}
    try:
        data = json.loads(HOTLIST.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return {"erreur": f"hotlist.json illisible : {e}", "pieces": []}

    verdicts = charger_verdicts()
    out = []
    for i, p in enumerate(data.get("products", [])):
        cle = "/".join(str(p.get(k, "")) for k in ("group", "brand", "range", "model", "piece"))
        v = verdicts.get(cle, {})
        out.append({
            "i": i, "cle": cle,
            "nom": p.get("name", ""), "machine": p.get("machine", ""),
            "marque": p.get("brand", ""), "modele": p.get("model", ""),
            "piece": p.get("piece", ""), "categorie": p.get("category", ""),
            "alertes": p.get("alerts") or 0,
            "statut": p.get("imageStatus", ""),
            "verdict": v.get("verdict", ""), "prix": v.get("prix", ""),
            "note": v.get("note", ""), "le": v.get("le", ""),
        })
    out.sort(key=lambda x: (-x["alertes"], x["nom"]))
    return {"pieces": out}


def charger_verdicts():
    if not VERDICTS.exists():
        return {}
    try:
        return json.loads(VERDICTS.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def enregistrer_verdict(cle, verdict, prix, note):
    v = charger_verdicts()
    v[cle] = {"verdict": verdict, "prix": prix, "note": note,
              "le": datetime.now().strftime("%Y-%m-%d %H:%M")}
    VERDICTS.write_text(json.dumps(v, ensure_ascii=False, indent=1), encoding="utf-8")
    return v[cle]


# --------------------------------------------------------------------------- recherche
def interroger(site, terme):
    """Va chercher la page et en extrait des indices. Ne conclut rien seul."""
    url = site["url"].format(q=quote_plus(terme))
    res = {"site": site["nom"], "cle": site["cle"], "url": url}
    try:
        req = Request(url, headers={"User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9"})
        with urlopen(req, timeout=20) as r:
            code = r.getcode()
            charset = r.headers.get_content_charset() or "utf-8"
            html = r.read(400_000).decode(charset, errors="replace")
    except HTTPError as e:
        res.update(etat="erreur", detail=f"HTTP {e.code}")
        return res
    except URLError as e:
        res.update(etat="erreur", detail=f"injoignable ({e.reason})")
        return res
    except Exception as e:
        res.update(etat="erreur", detail=str(e)[:120])
        return res

    bas = html.lower()
    # Le terme cherché figure-t-il dans la page ?
    mots = [m for m in re.split(r"[\s/,-]+", terme.lower()) if len(m) > 3]
    presents = [m for m in mots if m in bas]

    prix = sorted({p.replace(",", ".") for p in RE_PRIX.findall(html)},
                  key=lambda x: float(x))[:5]
    rupture = [m for m in MOTS_RUPTURE if m in bas]
    dispo = [m for m in MOTS_DISPO if m in bas]

    res.update(
        etat="ok", detail=f"HTTP {code}",
        termes_trouves=presents, termes_cherches=mots,
        prix=prix, rupture=rupture[:3], dispo=dispo[:3],
    )
    return res


# --------------------------------------------------------------------------- serveur
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # silence : la console reste lisible

    def _envoyer(self, corps, ctype="application/json; charset=utf-8", code=200):
        if isinstance(corps, (dict, list)):
            corps = json.dumps(corps, ensure_ascii=False)
        data = corps.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)

        if u.path == "/":
            return self._envoyer(PAGE, "text/html; charset=utf-8")

        if u.path == "/api/pieces":
            return self._envoyer(charger_pieces())

        if u.path == "/api/recherche":
            terme = (q.get("q") or [""])[0].strip()
            if not terme:
                return self._envoyer({"erreur": "terme vide"}, code=400)
            cles = (q.get("sites") or [""])[0].split(",")
            choisis = [s for s in SITES if not cles[0] or s["cle"] in cles]
            # En parallèle : sinon quatre sites à 20 s de délai font une minute.
            out, fils = [], []
            for s in choisis:
                t = threading.Thread(target=lambda ss=s: out.append(interroger(ss, terme)))
                t.start()
                fils.append(t)
            for t in fils:
                t.join(timeout=25)
            ordre = {s["cle"]: i for i, s in enumerate(SITES)}
            out.sort(key=lambda r: ordre.get(r["cle"], 99))
            return self._envoyer({"terme": terme, "resultats": out})

        return self._envoyer({"erreur": "route inconnue"}, code=404)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/api/verdict":
            return self._envoyer({"erreur": "route inconnue"}, code=404)
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return self._envoyer({"erreur": "corps illisible"}, code=400)
        cle = body.get("cle")
        if not cle:
            return self._envoyer({"erreur": "clé manquante"}, code=400)
        v = enregistrer_verdict(cle, body.get("verdict", ""),
                                body.get("prix", ""), body.get("note", ""))
        return self._envoyer({"ok": True, "verdict": v})


# --------------------------------------------------------------------------- page
def _nav_html():
    out = []
    for lbl, actif in NAV:
        cls = ' class="on"' if actif else ""
        out.append(f'<a href="#"{cls}>{lbl}</a>')
    return "".join(out)


PAGE = """<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hub4Fix — Recherche</title>
<style>
:root{--red:#C8102E;--ink:#1C1A18;--earth:#7A7268;--cream:#F3EEE8;
      --line:#EDE6DC;--ivory:#FAF8F5;--green:#2D8B5E;--amber:#b8860b}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,'Segoe UI',sans-serif;color:var(--ink);background:var(--ivory);display:flex;min-height:100vh}
.side{width:236px;flex:0 0 236px;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.brand{font-family:Georgia,serif;font-size:1.3rem;font-weight:600;padding:1.3rem 1.4rem;border-bottom:1px solid var(--line)}
.brand sup{color:var(--red)}
.brand span{display:block;font-family:system-ui;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:var(--earth);font-weight:600;margin-top:.15rem}
.nav{padding:.6rem .5rem;flex:1;overflow:auto}
.nav a{display:block;padding:.6rem .9rem;margin:.15rem 0;border-radius:7px;color:var(--earth);text-decoration:none;font-size:.9rem;font-weight:500;border-left:3px solid transparent;cursor:default}
.nav a.on{background:rgba(200,16,46,.07);border-left-color:var(--red);color:var(--red);cursor:default}
.side-foot{padding:1rem 1.4rem;border-top:1px solid var(--line);font-size:.72rem;color:var(--earth)}
.main{flex:1;min-width:0;display:flex;flex-direction:column;height:100vh}
.top{padding:1.4rem 1.6rem .9rem;border-bottom:1px solid var(--line);background:#fff}
h1{font-family:Georgia,serif;font-size:1.5rem;font-weight:500}
.sub{font-size:.84rem;color:var(--earth);margin-top:.2rem}
.cols{flex:1;display:flex;min-height:0}
.liste{width:44%;min-width:320px;border-right:1px solid var(--line);overflow:auto;padding:1rem}
.detail{flex:1;overflow:auto;padding:1rem 1.3rem;background:#fff}
.p{border:1px solid var(--line);border-radius:8px;padding:.7rem .85rem;margin-bottom:.5rem;cursor:pointer;background:#fff}
.p:hover{border-color:var(--red)}
.p.sel{border-color:var(--red);background:rgba(200,16,46,.04)}
.p h3{font-size:.9rem;font-weight:600;margin-bottom:.15rem}
.p .m{font-size:.76rem;color:var(--earth)}
.p .r{display:flex;gap:.4rem;align-items:center;margin-top:.4rem;flex-wrap:wrap}
.tag{font-size:.66rem;font-weight:700;padding:.13rem .45rem;border-radius:3px;text-transform:uppercase;letter-spacing:.04em}
.t-al{background:var(--cream);color:var(--earth)}
.t-dispo{background:#fdeaed;color:var(--red)}
.t-intro{background:#e8f5ee;color:var(--green)}
.t-doute{background:#fdf3e0;color:var(--amber)}
.vide{color:var(--earth);font-size:.85rem;padding:2rem 0;text-align:center}
h2{font-family:Georgia,serif;font-size:1.2rem;margin-bottom:.15rem}
.mm{font-size:.82rem;color:var(--earth);margin-bottom:.9rem}
.bar{display:flex;gap:.4rem;flex-wrap:wrap;margin:.6rem 0 1rem}
button{font-family:inherit;font-size:.8rem;font-weight:600;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:7px;padding:.45rem .8rem;cursor:pointer}
button:hover{border-color:var(--red)}
button.go{background:var(--red);color:#fff;border-color:var(--red)}
button.go:disabled{background:var(--cream);color:var(--earth);border-color:var(--line);cursor:wait}
input[type=text]{font-family:inherit;font-size:.82rem;padding:.45rem .6rem;border:1px solid var(--line);border-radius:7px}
.res{border:1px solid var(--line);border-radius:8px;margin-bottom:.6rem;overflow:hidden}
.res h4{font-size:.82rem;padding:.5rem .7rem;background:var(--cream);display:flex;justify-content:space-between;align-items:center}
.res .b{padding:.6rem .7rem;font-size:.8rem;line-height:1.6}
.res a{color:var(--red)}
.chip{display:inline-block;font-size:.72rem;padding:.1rem .4rem;border-radius:3px;background:var(--cream);margin:0 .2rem .2rem 0}
.chip.ko{background:#fdeaed;color:var(--red)}
.chip.ok{background:#e8f5ee;color:var(--green)}
.verdict{border-top:1px solid var(--line);margin-top:1rem;padding-top:.9rem}
.verdict .row{display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-bottom:.5rem}
small{color:var(--earth)}
</style></head><body>

<aside class="side">
  <div class="brand">Hub<sup>4</sup>Fix<span>Recherche</span></div>
  <nav class="nav" id="nav"></nav>
  <div class="side-foot">Poste local · <span id="cpt">—</span></div>
</aside>

<div class="main">
  <div class="top">
    <h1>Liste en attente</h1>
    <p class="sub">Vérifier si la pièce est encore vendue avant de la modéliser. Une pièce encore disponible à bas prix ne vaut pas le travail.</p>
  </div>
  <div class="cols">
    <div class="liste" id="liste"><div class="vide">Chargement…</div></div>
    <div class="detail" id="detail"><div class="vide">Choisir une pièce à gauche.</div></div>
  </div>
</div>

<script>
const NAV = __NAV__;
let PIECES = [], SEL = null;

document.getElementById('nav').innerHTML =
  NAV.map(([l,on]) => `<a href="#" class="${on?'on':''}">${l}</a>`).join('');

function tagVerdict(v){
  if(v==='introuvable') return '<span class="tag t-intro">introuvable</span>';
  if(v==='disponible')  return '<span class="tag t-dispo">encore vendue</span>';
  if(v==='doute')       return '<span class="tag t-doute">à revoir</span>';
  return '';
}

async function charger(){
  const r = await fetch('/api/pieces'); const d = await r.json();
  if(d.erreur){ document.getElementById('liste').innerHTML =
    `<div class="vide">${d.erreur}</div>`; return; }
  PIECES = d.pieces;
  const faits = PIECES.filter(p=>p.verdict).length;
  document.getElementById('cpt').textContent = `${faits}/${PIECES.length} vérifiées`;
  document.getElementById('liste').innerHTML = PIECES.map((p,i)=>`
    <div class="p ${SEL===i?'sel':''}" onclick="ouvrir(${i})">
      <h3>${esc(p.nom)}</h3>
      <div class="m">${esc(p.machine)}</div>
      <div class="r"><span class="tag t-al">${p.alertes} alertes</span>${tagVerdict(p.verdict)}</div>
    </div>`).join('');
}

function esc(s){ return (s||'').replace(/[&<>"]/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function ouvrir(i){
  SEL = i; const p = PIECES[i];
  charger();
  const terme = [p.marque, p.modele].filter(Boolean).join(' ');
  document.getElementById('detail').innerHTML = `
    <h2>${esc(p.nom)}</h2>
    <div class="mm">${esc(p.machine)}</div>
    <div class="row" style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
      <input type="text" id="q" value="${esc(terme)}" style="flex:1;min-width:220px">
      <button class="go" id="btn" onclick="chercher()">Chercher</button>
    </div>
    <small>Le terme est modifiable : une référence exacte donne de bien meilleurs résultats qu'un nom de gamme.</small>
    <div id="res" style="margin-top:1rem"></div>
    <div class="verdict">
      <div class="row">
        <button onclick="verdict('introuvable')">Introuvable — à modéliser</button>
        <button onclick="verdict('disponible')">Encore vendue</button>
        <button onclick="verdict('doute')">À revoir</button>
      </div>
      <div class="row">
        <input type="text" id="prix" placeholder="prix constaté" value="${esc(p.prix)}" style="width:130px">
        <input type="text" id="note" placeholder="note" value="${esc(p.note)}" style="flex:1;min-width:200px">
      </div>
      <small id="vst">${p.verdict ? 'Dernier verdict : '+esc(p.verdict)+' — '+esc(p.le) : 'Pas encore de verdict.'}</small>
    </div>`;
}

async function chercher(){
  const q = document.getElementById('q').value.trim();
  if(!q) return;
  const b = document.getElementById('btn');
  b.disabled = true; b.textContent = 'Recherche…';
  document.getElementById('res').innerHTML = '<div class="vide">Interrogation des sites…</div>';
  try{
    const r = await fetch('/api/recherche?q='+encodeURIComponent(q));
    const d = await r.json();
    document.getElementById('res').innerHTML = d.resultats.map(x=>{
      if(x.etat!=='ok') return `<div class="res"><h4>${esc(x.site)}
        <span class="chip ko">${esc(x.detail)}</span></h4>
        <div class="b"><a href="${x.url}" target="_blank">ouvrir la page</a></div></div>`;
      const tr = x.termes_trouves.length, tc = x.termes_cherches.length;
      return `<div class="res"><h4>${esc(x.site)}
        <span class="chip">${esc(x.detail)}</span></h4><div class="b">
        <div>Termes retrouvés dans la page : <b>${tr}/${tc}</b>
          ${x.termes_trouves.map(t=>`<span class="chip ok">${esc(t)}</span>`).join('')}</div>
        ${x.prix.length?`<div>Prix repérés : ${x.prix.map(p=>`<span class="chip">${p} €</span>`).join('')}</div>`:''}
        ${x.rupture.length?`<div>Signaux de rupture : ${x.rupture.map(m=>`<span class="chip ko">${esc(m)}</span>`).join('')}</div>`:''}
        ${x.dispo.length?`<div>Signaux de disponibilité : ${x.dispo.map(m=>`<span class="chip ok">${esc(m)}</span>`).join('')}</div>`:''}
        <div style="margin-top:.4rem"><a href="${x.url}" target="_blank">ouvrir la page pour vérifier</a></div>
      </div></div>`;
    }).join('') + `<small>Ces indices disent où regarder. Le verdict reste le vôtre : ouvrez la page avant de trancher.</small>`;
  }catch(e){
    document.getElementById('res').innerHTML = `<div class="vide">Échec : ${esc(String(e))}</div>`;
  }
  b.disabled = false; b.textContent = 'Chercher';
}

async function verdict(v){
  const p = PIECES[SEL];
  const r = await fetch('/api/verdict', {method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({cle:p.cle, verdict:v,
      prix:document.getElementById('prix').value,
      note:document.getElementById('note').value})});
  const d = await r.json();
  if(d.ok){
    p.verdict=v; p.prix=d.verdict.prix; p.note=d.verdict.note; p.le=d.verdict.le;
    document.getElementById('vst').textContent = 'Enregistré : '+v+' — '+d.verdict.le;
    charger();
  }
}

charger();
</script></body></html>
""".replace("__NAV__", json.dumps(NAV, ensure_ascii=False))


def main():
    if not HOTLIST.exists():
        print(f"hotlist.json introuvable : {HOTLIST}")
        print("Lancer ce script depuis la racine du depot.")
        return 1
    n = len(charger_pieces().get("pieces", []))
    url = f"http://127.0.0.1:{PORT}/"
    print("=" * 58)
    print("  Hub4Fix - poste de recherche")
    print("=" * 58)
    print(f"  {n} pieces chargees")
    print(f"  Ouvert sur : {url}")
    print("  Fermer cette fenetre pour arreter.")
    print("=" * 58)
    try:
        srv = HTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as e:
        print(f"\nPort {PORT} occupe ({e}).")
        print("Fermer l'autre fenetre du poste de recherche, ou changer PORT.")
        return 1
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nArret.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
