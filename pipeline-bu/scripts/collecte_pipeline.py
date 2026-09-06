#!/usr/bin/env python3
"""
Pipeline Proactif BU — Hub4Fix
Collecte de signaux de rareté de pièces détachées.

Règles immuables :
- Jamais stocker le texte brut des posts (RGPD + IP) — seulement les faits extraits
- Rate limiting : 2 s entre requêtes (RATE_LIMIT_SECONDS)
- Vérifier robots.txt avant d'ajouter une nouvelle source en rotation
- Pas de contournement de CAPTCHA ni de protection anti-bot
- Leboncoin interdit le scraping automatisé → lecture manuelle uniquement
- Sources JS-rendues ou login-gated (Geev, Facebook) → Claude en Chrome supervisé uniquement
"""

import csv
import json
import sys
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, date
from pathlib import Path
from typing import Optional
from urllib.parse import quote_plus, urlparse
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

RATE_LIMIT_SECONDS = 2.0
USER_AGENT = "Hub4Fix-Pipeline-Bot/1.0 (reparation@hub4fix.com)"
DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_CSV = DATA_DIR / "vivier_brut_collecte.csv"
RUN_LOG = DATA_DIR / "run_log.jsonl"

# Grille de scoring rareté (0-7 points)
SCORING_GRID = {
    "marque_disparue": 1,       # Marque disparue / rachetée / SAV arrêté
    "anciennete_forte": 1,      # > 7-10 ans
    "sans_reseau_france": 1,    # Marque étrangère sans réseau SAV France
    "rupture_fournisseur": 1,   # Rupture constatée (délai > 4-6 sem.)
    "retire_catalogue": 1,      # Référence retirée des catalogues officiels
    "signal_communautaire": 1,  # Signaux répétés (forums, avis)
    "prix_anormal_marche_gris": 1,  # Prix anormal sur marché d'occasion
}

# Catégories exclues pour raisons de sécurité (rédhibitoires)
EXCLUSIONS_SECURITE = [
    "sous pression", "haute chaleur", "securite electrique",
    "structurel", "porteur", "mobilier", "frein", "fourche",
    "direction", "velo", "trottinette",
]

# Sources de forums actives en rotation
FORUM_SOURCES = [
    {
        "name": "commentreparer.com",
        "search_url": "https://www.commentreparer.com/recherche/?q={query}",
        "base_url": "https://www.commentreparer.com",
        "type": "forum",
    },
    {
        "name": "forum.adepem.com",
        "search_url": "https://forum.adepem.com/search?q={query}",
        "base_url": "https://forum.adepem.com",
        "type": "forum",
    },
    {
        "name": "forum.quechoisir.org",
        "search_url": "https://forum.quechoisir.org/search?q={query}",
        "base_url": "https://forum.quechoisir.org",
        "type": "forum",
    },
]

# Sources de pièces détachées (vérification stock/délai)
PIECE_SOURCES = [
    {
        "name": "sos-accessoire.com",
        "search_url": "https://www.sos-accessoire.com/catalogsearch/result/?q={ref}",
        "base_url": "https://www.sos-accessoire.com",
        "type": "pieces",
    },
    {
        "name": "spareka.fr",
        "search_url": "https://www.spareka.fr/recherche?q={ref}",
        "base_url": "https://www.spareka.fr",
        "type": "pieces",
    },
    {
        "name": "fixpart.fr",
        "search_url": "https://www.fixpart.fr/fr/recherche?q={ref}",
        "base_url": "https://www.fixpart.fr",
        "type": "pieces",
    },
]

# Pages officielles de marques à surveiller
BRAND_PAGES = [
    {
        "name": "Moulinex SAV",
        "url": "https://www.moulinex.fr/pieces-detachees",
        "brand": "Moulinex",
    },
    {
        "name": "SEB SAV",
        "url": "https://www.seb.fr/pieces-detachees-accessoires",
        "brand": "SEB",
    },
    {
        "name": "Krups SAV",
        "url": "https://www.krups.fr/pieces-detachees",
        "brand": "Krups",
    },
    {
        "name": "Bosch electromenager",
        "url": "https://www.bosch-home.fr/service/pieces-detachees-accessoires",
        "brand": "Bosch",
    },
]

# Requêtes génériques par catégorie pour découverte de nouveaux signaux
SEARCH_QUERIES = [
    "pièce détachée introuvable",
    "plus de pièces disponibles",
    "pièce épuisée définitivement",
    "référence discontinuée",
    "pièce obsolète",
    "rupture de stock prolongée",
    "pièce plus fabriquée",
    "fin de production pièce",
]


# ---------------------------------------------------------------------------
# Structures de données
# ---------------------------------------------------------------------------

@dataclass
class SignalRarete:
    """Un signal de rareté extrait d'une source."""
    date_collecte: str = field(default_factory=lambda: date.today().isoformat())
    source_nom: str = ""
    source_type: str = ""     # forum | pieces | marque | wayback | marketplace_occasion
    lien_preuve: str = ""     # URL du post/page (jamais le texte brut)
    marque: str = ""
    modele: str = ""
    reference: str = ""
    symptome: str = ""        # Description courte du problème signalé
    categorie_piece: str = ""
    score_rarete: int = 0
    details_score: str = ""   # ex: "retire_catalogue+signal_communautaire"
    statut: str = "Brut"      # Brut | A verifier | Qualifie | Exclu
    note_exclusion: str = ""
    verif_independante: str = ""  # Résultat de la vérification croisée


# ---------------------------------------------------------------------------
# Utilitaires réseau
# ---------------------------------------------------------------------------

def fetch_url(url: str, timeout: int = 15) -> Optional[str]:
    """Récupère le contenu d'une URL avec rate limiting et User-Agent correct."""
    req = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(req, timeout=timeout) as resp:
            charset = resp.headers.get_content_charset() or "utf-8"
            content = resp.read().decode(charset, errors="replace")
        time.sleep(RATE_LIMIT_SECONDS)
        return content
    except HTTPError as e:
        print(f"  [HTTP {e.code}] {url}", file=sys.stderr)
        time.sleep(RATE_LIMIT_SECONDS)
        return None
    except URLError as e:
        print(f"  [URL Error] {url}: {e.reason}", file=sys.stderr)
        time.sleep(RATE_LIMIT_SECONDS)
        return None
    except Exception as e:
        print(f"  [Error] {url}: {e}", file=sys.stderr)
        time.sleep(RATE_LIMIT_SECONDS)
        return None


def check_robots_txt(base_url: str, path: str = "/") -> bool:
    """Vérifie sommairement si le chemin est autorisé dans robots.txt."""
    try:
        parsed = urlparse(base_url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        content = fetch_url(robots_url)
        if not content:
            return True  # Pas de robots.txt lisible = autorisé par défaut
        lines = content.lower().splitlines()
        is_our_agent = False
        for line in lines:
            line = line.strip()
            if line.startswith("user-agent:"):
                agent = line.split(":", 1)[1].strip()
                is_our_agent = agent in ("*", "hub4fix", "hub4fix-pipeline-bot")
            if is_our_agent and line.startswith("disallow:"):
                disallowed = line.split(":", 1)[1].strip()
                if disallowed and (path.startswith(disallowed) or disallowed == "/"):
                    return False
        return True
    except Exception:
        return True


# ---------------------------------------------------------------------------
# Wayback Machine — CDX API
# ---------------------------------------------------------------------------

def scan_wayback_machine(ref: str, domain: str = "") -> list[SignalRarete]:
    """
    Cherche des snapshots Wayback d'une référence ou d'un domaine.
    Utile pour prouver qu'une page catalogue a existé puis disparu.
    """
    signals = []
    query = ref if ref else domain
    if not query:
        return signals

    cdx_url = (
        "https://web.archive.org/cdx/search/cdx"
        f"?url=*{quote_plus(query)}*"
        "&output=json&limit=5&fl=timestamp,original,statuscode"
        "&filter=statuscode:200&collapse=urlkey"
    )
    content = fetch_url(cdx_url)
    if not content:
        return signals

    try:
        rows = json.loads(content)
        if len(rows) <= 1:  # Première ligne = en-têtes
            return signals
        for row in rows[1:]:
            ts, original_url = row[0], row[1]
            archive_url = f"https://web.archive.org/web/{ts}/{original_url}"
            signals.append(SignalRarete(
                source_nom="Wayback Machine",
                source_type="wayback",
                lien_preuve=archive_url,
                reference=ref,
                symptome=f"Page archivée trouvée ({ts[:8]})",
                score_rarete=1,
                details_score="retire_catalogue",
            ))
    except (json.JSONDecodeError, IndexError):
        pass

    return signals


# ---------------------------------------------------------------------------
# Scanner — Forums spécialisés
# ---------------------------------------------------------------------------

def scan_forums(queries: Optional[list[str]] = None) -> list[SignalRarete]:
    """
    Scanne les forums de réparation pour des mentions de pièces introuvables.
    Extrait uniquement : lien, référence si détectable, symptôme court.
    NE STOCKE PAS le texte brut des posts.
    """
    signals = []
    queries = queries or SEARCH_QUERIES

    ref_pattern = re.compile(r'\b([A-Z]{2,4}[-\s]?\d{4,10}[-\s]?\w{0,6})\b', re.IGNORECASE)
    rarete_keywords = [
        "introuvable", "épuisé", "plus disponible", "discontinué",
        "plus fabriqué", "rupture", "impossible à trouver", "obsolète",
        "plus de pièce", "fin de série",
    ]

    for source in FORUM_SOURCES:
        if not check_robots_txt(source["base_url"], "/search"):
            print(f"  [Robots] {source['name']} : accès non autorisé, skip")
            continue

        for query in queries[:3]:  # Limite à 3 requêtes par source par run
            url = source["search_url"].format(query=quote_plus(query))
            print(f"  Scan forum : {source['name']} — '{query}'")
            content = fetch_url(url)
            if not content:
                continue

            title_pattern = re.compile(
                r'<(?:h[1-4]|a)[^>]*>([^<]{10,200})</(?:h[1-4]|a)>', re.IGNORECASE
            )
            link_pattern = re.compile(r'href=["\']([^"\']+)["\']', re.IGNORECASE)

            titles = title_pattern.findall(content)
            links = link_pattern.findall(content)

            for i, title in enumerate(titles[:20]):
                titre_lower = title.lower()
                if not any(kw in titre_lower for kw in rarete_keywords):
                    continue

                refs = ref_pattern.findall(title)
                ref = refs[0] if refs else ""

                lien = ""
                if i < len(links):
                    candidate = links[i]
                    if candidate.startswith("http"):
                        lien = candidate
                    elif candidate.startswith("/"):
                        lien = source["base_url"] + candidate

                if not lien:
                    continue  # Pas de preuve = on n'enregistre pas

                score = 0
                score_details = []
                if any(kw in titre_lower for kw in ["discontinué", "plus fabriqué", "fin de série"]):
                    score += 1
                    score_details.append("retire_catalogue")
                if any(kw in titre_lower for kw in ["introuvable", "impossible à trouver"]):
                    score += 1
                    score_details.append("signal_communautaire")
                if any(kw in titre_lower for kw in ["rupture", "épuisé"]):
                    score += 1
                    score_details.append("rupture_fournisseur")

                symptome = title[:120].strip()
                if len(title) > 120:
                    symptome += "…"

                exclu = any(ex in titre_lower for ex in EXCLUSIONS_SECURITE)

                signals.append(SignalRarete(
                    source_nom=source["name"],
                    source_type="forum",
                    lien_preuve=lien,
                    reference=ref,
                    symptome=symptome,
                    score_rarete=score,
                    details_score="+".join(score_details),
                    statut="Exclu" if exclu else "Brut",
                    note_exclusion="Exclusion securite" if exclu else "",
                ))

    return signals


# ---------------------------------------------------------------------------
# Scanner — Sites de pièces détachées (stock / délai)
# ---------------------------------------------------------------------------

def scan_sites_pieces_detachees(references: Optional[list[str]] = None) -> list[SignalRarete]:
    """
    Vérifie la disponibilité de références connues sur les sites de pièces.
    Signale si délai > 4 sem. ou rupture confirmée.
    """
    signals = []
    if not references:
        return signals

    rupture_keywords = [
        "rupture", "épuisé", "indisponible", "hors stock",
        "sur commande", "non disponible", "article retiré",
    ]

    for source in PIECE_SOURCES:
        if not check_robots_txt(source["base_url"], "/recherche"):
            print(f"  [Robots] {source['name']} : accès non autorisé, skip")
            continue

        for ref in references[:10]:  # Limite par run
            url = source["search_url"].format(ref=quote_plus(ref))
            print(f"  Vérif stock : {source['name']} — {ref}")
            content = fetch_url(url)
            if not content:
                continue

            content_lower = content.lower()
            found_rupture = any(kw in content_lower for kw in rupture_keywords)

            delay_pattern = re.compile(r'(\d+)\s*(?:à\s*\d+\s*)?semaines?', re.IGNORECASE)
            delays = [int(m.group(1)) for m in delay_pattern.finditer(content)]
            long_delay = any(d > 4 for d in delays)

            if found_rupture or long_delay:
                details = "rupture_fournisseur"
                if long_delay:
                    details += f"+delai_{max(delays)}sem"

                signals.append(SignalRarete(
                    source_nom=source["name"],
                    source_type="pieces",
                    lien_preuve=url,
                    reference=ref,
                    symptome=f"Rupture ou délai long ({source['name']})",
                    score_rarete=1,
                    details_score=details,
                    statut="Brut",
                ))

    return signals


# ---------------------------------------------------------------------------
# Scanner — Pages officielles marques
# ---------------------------------------------------------------------------

def scan_pages_marques(references: Optional[list[str]] = None) -> list[SignalRarete]:
    """
    Surveille les pages SAV des marques pour détecter des références retirées
    du catalogue officiel.
    """
    signals = []
    retire_keywords = [
        "retiré", "discontinued", "plus disponible", "ne fait plus partie",
        "référence obsolète", "hors catalogue", "fin de vie",
    ]
    ref_pattern = re.compile(r'\b([A-Z]{2,4}[-\s]?\d{4,10})\b', re.IGNORECASE)

    for brand_page in BRAND_PAGES:
        print(f"  Scan marque : {brand_page['name']}")
        if not check_robots_txt(brand_page["url"]):
            print(f"  [Robots] {brand_page['name']} : accès non autorisé, skip")
            continue

        content = fetch_url(brand_page["url"])
        if not content:
            continue

        content_lower = content.lower()

        # Cas 1 : une référence connue apparaît dans un contexte de retrait
        if references:
            for ref in references:
                if ref.lower() in content_lower:
                    idx = content_lower.find(ref.lower())
                    context = content[max(0, idx - 200):idx + 200].lower()
                    if any(kw in context for kw in retire_keywords):
                        signals.append(SignalRarete(
                            source_nom=brand_page["name"],
                            source_type="marque",
                            lien_preuve=brand_page["url"],
                            marque=brand_page["brand"],
                            reference=ref,
                            symptome="Référence connue en contexte de retrait catalogue",
                            score_rarete=1,
                            details_score="retire_catalogue",
                            statut="Brut",
                        ))

        # Cas 2 : mention générique de retrait, on récupère les refs du contexte
        for kw in retire_keywords:
            if kw in content_lower:
                idx = content_lower.find(kw)
                context = content[max(0, idx - 100):idx + 100]
                for ref in ref_pattern.findall(context)[:2]:
                    signals.append(SignalRarete(
                        source_nom=brand_page["name"],
                        source_type="marque",
                        lien_preuve=brand_page["url"],
                        marque=brand_page["brand"],
                        reference=ref,
                        symptome=f"Mot-cle retrait detecte : '{kw}'",
                        score_rarete=1,
                        details_score="retire_catalogue",
                        statut="Brut",
                    ))
                break  # Un seul signal générique par page par run

    return signals


# ---------------------------------------------------------------------------
# Scanner — Marketplaces occasion (eBay uniquement — Leboncoin = manuel)
# ---------------------------------------------------------------------------

def scan_marketplaces_occasion(references: Optional[list[str]] = None) -> list[SignalRarete]:
    """
    Scanne eBay.fr (annonces vendues) pour détecter des prix anormaux.
    IMPORTANT : Leboncoin interdit le scraping automatise (CGU) -> lecture manuelle.
    """
    signals = []
    if not references:
        return signals

    if not check_robots_txt("https://www.ebay.fr", "/sch/"):
        print("  [Robots] eBay.fr /sch/ non autorise, skip")
        return signals

    price_pattern = re.compile(r'(\d+[,.]?\d*)\s*EUR', re.IGNORECASE)

    for ref in references[:5]:  # Limite par run
        url = (
            "https://www.ebay.fr/sch/i.html"
            f"?_nkw={quote_plus(ref)}&_sacat=0&LH_Sold=1&LH_Complete=1"
        )
        print(f"  Scan eBay occasion : {ref}")
        content = fetch_url(url)
        if not content:
            continue

        prices = []
        for p in price_pattern.findall(content):
            try:
                v = float(p.replace(",", "."))
                if v > 0:
                    prices.append(v)
            except ValueError:
                continue

        if len(prices) >= 3:
            avg_price = sum(prices) / len(prices)
            max_price = max(prices)
            # Signal si le haut du marché dépasse 3x la moyenne (marché gris)
            if avg_price > 5 and max_price > avg_price * 3:
                signals.append(SignalRarete(
                    source_nom="eBay.fr (vendus)",
                    source_type="marketplace_occasion",
                    lien_preuve=url,
                    reference=ref,
                    symptome=f"Prix anormal marche gris (max {max_price:.0f} EUR vs moy {avg_price:.0f} EUR)",
                    score_rarete=1,
                    details_score="prix_anormal_marche_gris",
                    statut="Brut",
                ))

    return signals


# ---------------------------------------------------------------------------
# Déduplication et scoring final
# ---------------------------------------------------------------------------

def deduplicate(signals: list[SignalRarete]) -> list[SignalRarete]:
    """Déduplique par (reference, source_nom) — garde le score le plus élevé."""
    seen: dict[str, SignalRarete] = {}
    for s in signals:
        key = f"{s.reference.lower()}|{s.source_nom}"
        if key not in seen or s.score_rarete > seen[key].score_rarete:
            seen[key] = s
    return list(seen.values())


def consolider_scores(signals: list[SignalRarete]) -> list[SignalRarete]:
    """
    Consolide les signaux multi-sources pour la même référence.
    Plusieurs forums sur la même ref => bonus signal_communautaire.
    """
    by_ref: dict[str, list[SignalRarete]] = {}
    for s in signals:
        key = s.reference.lower() if s.reference else s.lien_preuve
        by_ref.setdefault(key, []).append(s)

    consolidated = []
    for ref_signals in by_ref.values():
        if len(ref_signals) == 1:
            consolidated.append(ref_signals[0])
            continue

        best = max(ref_signals, key=lambda x: x.score_rarete)
        all_details = set()
        for s in ref_signals:
            all_details.update(d for d in s.details_score.split("+") if d)

        if len([s for s in ref_signals if s.source_type == "forum"]) > 1:
            all_details.add("signal_communautaire")
            best.score_rarete = min(7, best.score_rarete + 1)

        best.details_score = "+".join(sorted(all_details))
        consolidated.append(best)

    return consolidated


# ---------------------------------------------------------------------------
# Export CSV
# ---------------------------------------------------------------------------

CSV_FIELDS = [
    "date_collecte", "source_nom", "source_type", "lien_preuve",
    "marque", "modele", "reference", "symptome", "categorie_piece",
    "score_rarete", "details_score", "statut", "note_exclusion",
    "verif_independante",
]


def load_existing_csv() -> list[dict]:
    """Charge le CSV existant pour éviter les doublons entre runs."""
    if not OUTPUT_CSV.exists():
        return []
    with open(OUTPUT_CSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_csv(signals: list[SignalRarete], existing: list[dict]) -> int:
    """Ajoute les nouveaux signaux au CSV. Retourne le nombre d'ajouts."""
    known_keys = {
        f"{row['reference'].lower()}|{row['source_nom']}"
        for row in existing
        if row.get("reference") and row.get("source_nom")
    }

    new_signals = [
        s for s in signals
        if f"{s.reference.lower()}|{s.source_nom}" not in known_keys
    ]
    if not new_signals:
        return 0

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_header = not OUTPUT_CSV.exists() or OUTPUT_CSV.stat().st_size == 0

    with open(OUTPUT_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        if write_header:
            writer.writeheader()
        for s in new_signals:
            writer.writerow(asdict(s))

    return len(new_signals)


def log_run(stats: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(RUN_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": datetime.utcnow().isoformat(), **stats}) + "\n")


# ---------------------------------------------------------------------------
# Point d'entrée principal
# ---------------------------------------------------------------------------

def charger_references_hotlist() -> list[str]:
    """Charge les références du vivier existant pour les vérifications croisées."""
    hotlist_path = (
        Path(__file__).parent.parent.parent / "hub4fix.com" / "data" / "hotlist.json"
    )
    if not hotlist_path.exists():
        return []
    try:
        with open(hotlist_path, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []
    return [
        p.get("reference") or p.get("piece", "")
        for p in data.get("products", [])
        if p.get("reference") or p.get("piece")
    ]


def main() -> int:
    print(f"=== Hub4Fix Pipeline BU — {date.today().isoformat()} ===")
    all_signals: list[SignalRarete] = []
    stats = {"forums": 0, "pieces": 0, "marques": 0, "marketplaces": 0}

    references_hotlist = charger_references_hotlist()
    print(f"  {len(references_hotlist)} références chargées depuis la hotlist")

    print("\n[1/4] Scan forums spécialisés…")
    forum_signals = scan_forums(SEARCH_QUERIES)
    all_signals.extend(forum_signals)
    stats["forums"] = len(forum_signals)
    print(f"  -> {len(forum_signals)} signaux forum")

    print("\n[2/4] Vérification stock/délai pièces…")
    pieces_signals = scan_sites_pieces_detachees(references_hotlist[:15])
    all_signals.extend(pieces_signals)
    stats["pieces"] = len(pieces_signals)
    print(f"  -> {len(pieces_signals)} signaux pièces")

    print("\n[3/4] Scan pages officielles marques…")
    marque_signals = scan_pages_marques(references_hotlist[:15])
    all_signals.extend(marque_signals)
    stats["marques"] = len(marque_signals)
    print(f"  -> {len(marque_signals)} signaux marques")

    print("\n[4/4] Scan eBay occasion…")
    marketplace_signals = scan_marketplaces_occasion(references_hotlist[:5])
    all_signals.extend(marketplace_signals)
    stats["marketplaces"] = len(marketplace_signals)
    print(f"  -> {len(marketplace_signals)} signaux marketplace")

    print("\n[Post-traitement] Déduplication et consolidation…")
    all_signals = deduplicate(all_signals)
    all_signals = consolider_scores(all_signals)
    all_signals.sort(key=lambda s: s.score_rarete, reverse=True)
    print(f"  -> {len(all_signals)} signaux nets")

    print("\n[Export] Écriture CSV…")
    existing = load_existing_csv()
    added = save_csv(all_signals, existing)
    print(f"  -> {added} nouveaux ajoutés (existant : {len(existing)})")

    stats["total_nets"] = len(all_signals)
    stats["nouveaux_ajoutes"] = added
    log_run(stats)

    print(f"\n=== Termine — {added} ajoutes, {len(all_signals)} nets ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
