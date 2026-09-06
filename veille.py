#!/usr/bin/env python3
"""
Veille du matin — Hub4Fix.

UNE commande, à lancer chaque matin :

    python3 veille.py

Ce que ça fait : lance la collecte, affiche un compte rendu lisible, et ajoute
une ligne au banc d'essai.

Pourquoi ce script existe plutôt qu'une infrastructure : on ne sait pas encore
si la veille automatique rapporte quoi que ce soit. Tant que ce n'est pas
mesuré sur plusieurs jours, construire des bases de données et des interfaces
revient à monter l'usine avant de savoir si le produit se vend.

Ce que le script persiste, et ce qu'il ne persiste pas — la distinction est
volontaire :

  * `pipeline-bu/bench.csv` — les COMPTES du jour. Versionné, parce que c'est
    ce qui permet de comparer les jours entre eux, et parce que des comptes ne
    révèlent rien : les sources surveillées sont déjà écrites dans le README.

  * `pipeline-bu/data/vivier_brut_collecte.csv` — les SIGNAUX eux-mêmes. Jamais
    versionné (dépôt public, et c'est l'actif). Il vit le temps de la session.
    Pendant un banc d'essai, ce n'est pas grave : la question n'est pas
    d'accumuler des pièces, c'est de savoir si ça vaut la peine d'en accumuler.

Options :
    --source forums|pieces|marques|marketplaces|all
    --limit N
    --sec        n'écrit rien, même pas le banc d'essai
"""

import csv
import io
import sys
from contextlib import redirect_stderr, redirect_stdout
from datetime import date, datetime
from pathlib import Path

RACINE = Path(__file__).parent
sys.path.insert(0, str(RACINE / "pipeline-bu" / "scripts"))

import collecte_pipeline as cp  # noqa: E402

BENCH = RACINE / "pipeline-bu" / "bench.csv"
BENCH_COLS = [
    "date", "heure", "source_demandee",
    "domaines_ok", "domaines_muets", "requetes_ok", "requetes_echec",
    "signaux_bruts", "signaux_nets", "score_max", "score_moyen",
    "nouveaux_ajoutes", "verdict_sources",
]

L = 72


def titre(t):
    print()
    print("─" * L)
    print(f" {t}")
    print("─" * L)


def main() -> int:
    args = sys.argv[1:]
    sec = "--sec" in args
    args = [a for a in args if a != "--sec"]
    opts = cp.parse_args(args)

    print()
    print("═" * L)
    print(f" VEILLE HUB4FIX — {date.today().strftime('%A %d %B %Y')}")
    print("═" * L)
    print(f" source : {opts['source']}    limite : {opts['limit'] or 'défaut'}"
          f"{'    (sec : rien ne sera écrit)' if sec else ''}")

    # La collecte est bavarde (une ligne par requête, utile en débogage mais
    # illisible à 8 h du matin). On la capture pour n'en ressortir que
    # l'essentiel, tout en la gardant disponible en cas de souci.
    cp.FETCH_STATS.clear()
    tampon = io.StringIO()
    print("\n Collecte en cours… (2 s entre chaque requête, soyez patient)")
    try:
        with redirect_stdout(tampon), redirect_stderr(tampon):
            cp.main(args + (["--dry-run"] if sec else []))
    except SystemExit:
        pass
    except Exception as e:
        print(f"\n La collecte s'est interrompue : {e}")
        print(" Journal complet ci-dessous.\n")
        print(tampon.getvalue()[-2000:])
        return 1

    journal = tampon.getvalue()

    # ---- 1. Les sources ont-elles répondu ? ----
    titre("LES SOURCES ONT-ELLES RÉPONDU ?")
    stats = cp.FETCH_STATS
    if not stats:
        print(" Aucune requête tentée. Vérifier les options.")
    ok_dom, muets = [], []
    req_ok = req_ko = 0
    for dom, st in sorted(stats.items()):
        req_ok += st["ok"]
        req_ko += sum(st["echecs"].values())
        if st["ok"] > 0:
            ok_dom.append(dom)
            detail = f"{st['ok']} réponse(s)"
            if st["echecs"]:
                detail += " · échecs : " + ", ".join(f"{k}×{v}" for k, v in st["echecs"].items())
            print(f"  ✓  {dom:<32} {detail}")
        else:
            muets.append(dom)
            print(f"  ✗  {dom:<32} " + ", ".join(f"{k}×{v}" for k, v in st["echecs"].items()))

    if muets:
        print()
        print(f" {len(muets)} domaine(s) muet(s). Un 403 ou un « injoignable » constant")
        print(" veut dire que la source refuse notre User-Agent ou exige une session :")
        print(" c'est une source à retirer de la rotation, pas un bug à corriger.")

    # ---- 2. Qu'a-t-on trouvé ? ----
    titre("CE QUI A ÉTÉ TROUVÉ")
    lignes = []
    if cp.OUTPUT_CSV.exists():
        with open(cp.OUTPUT_CSV, newline="", encoding="utf-8") as f:
            lignes = list(csv.DictReader(f))
    dujour = [r for r in lignes if r.get("date_collecte") == date.today().isoformat()]

    def num(r):
        try:
            return int(r.get("score_rarete") or 0)
        except ValueError:
            return 0

    nets = len(dujour)
    scores = [num(r) for r in dujour]
    score_max = max(scores) if scores else 0
    score_moy = round(sum(scores) / len(scores), 2) if scores else 0

    if not dujour:
        print(" Aucun signal aujourd'hui.")
        if ok_dom:
            print()
            print(" Des sources ont répondu mais rien n'a été extrait : ce sont donc")
            print(" les motifs d'extraction qu'il faut revoir, pas l'accès aux sources.")
            print(" C'est une information utile, pas un échec du passage.")
    else:
        print(f" {nets} signal(aux) — score max {score_max}/7, moyenne {score_moy}/7")
        print()
        for r in sorted(dujour, key=num, reverse=True)[:12]:
            ref = (r.get("reference") or "—")[:20]
            print(f"  {num(r)}/7  {ref:<20} {(r.get('source_nom') or '')[:22]:<22} {(r.get('symptome') or '')[:40]}")
        print()
        print(" À juger à l'œil : combien de ces lignes sont de vrais signaux ?")
        print(" C'est cette proportion qui dira si la veille vaut une automatisation.")

    # ---- 3. Comparaison avec les jours précédents ----
    titre("BANC D'ESSAI")
    hist = []
    if BENCH.exists():
        with open(BENCH, newline="", encoding="utf-8") as f:
            hist = list(csv.DictReader(f))
    if hist:
        print(f" {len(hist)} passage(s) déjà enregistré(s) :")
        print()
        print(f"  {'date':<12} {'sources ok':>10} {'nets':>6} {'max':>5}")
        for h in hist[-7:]:
            print(f"  {h.get('date',''):<12} {h.get('domaines_ok',''):>10} "
                  f"{h.get('signaux_nets',''):>6} {h.get('score_max',''):>5}")
        print(f"  {date.today().isoformat():<12} {len(ok_dom):>10} {nets:>6} {score_max:>5}   ← aujourd'hui")
    else:
        print(" Premier passage. C'est la ligne de référence.")

    verdict = "aucune source ne repond" if not ok_dom else (
        "sources ok, rien extrait" if nets == 0 else "sources ok, signaux extraits")

    if not sec:
        neuf = not BENCH.exists()
        with open(BENCH, "a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=BENCH_COLS)
            if neuf:
                w.writeheader()
            w.writerow({
                "date": date.today().isoformat(),
                "heure": datetime.now().strftime("%H:%M"),
                "source_demandee": opts["source"],
                "domaines_ok": len(ok_dom),
                "domaines_muets": len(muets),
                "requetes_ok": req_ok,
                "requetes_echec": req_ko,
                "signaux_bruts": len(lignes),
                "signaux_nets": nets,
                "score_max": score_max,
                "score_moyen": score_moy,
                "nouveaux_ajoutes": nets,
                "verdict_sources": verdict,
            })
        print()
        print(f" Ligne ajoutée à {BENCH.relative_to(RACINE)}")

    # ---- 4. Quoi faire maintenant ----
    titre("ET MAINTENANT")
    if not ok_dom:
        print(" Aucune source n'a répondu. Deux causes possibles, dans cet ordre :")
        print("   1. l'environnement n'a pas d'accès réseau sortant — le plus probable")
        print("      ici ; vérifier avec :  curl -sS -o /dev/null -w '%{http_code}' https://example.com")
        print("   2. les sources refusent toutes notre User-Agent — improbable d'un coup")
        print(" Rien à conclure sur la veille elle-même tant que ce point n'est pas levé.")
    elif nets == 0:
        print(" Les sources répondent, l'extraction ne trouve rien. Prochaine étape :")
        print("   python3 veille.py --source forums --limit 1")
        print(" puis lire le HTML réellement renvoyé pour corriger les motifs.")
    else:
        print(" Relire les lignes ci-dessus et compter les vrais signaux.")
        print(" Trois matins de suite avec une majorité de signaux justes suffisent")
        print(" à décider d'automatiser. En dessous, ça ne vaut pas l'infrastructure.")
    print()
    print(f" Journal détaillé : {len(journal.splitlines())} lignes, gardées en mémoire.")
    print(" Le relancer avec --source X pour creuser une famille.")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
