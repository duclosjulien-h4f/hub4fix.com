#!/usr/bin/env python3
"""
Veille Hub4Fix — fenêtre de lancement.

Double-cliquer ce fichier sous Windows : l'extension .pyw ouvre la fenêtre
sans console noire derrière. Voir LANCER-VEILLE.md pour poser le raccourci
sur le bureau avec le logo H4F.

Cette fenêtre ne collecte rien elle-même : elle lance `veille.py` en
sous-processus et affiche sa sortie au fil de l'eau. C'est délibéré — la
fenêtre et la ligne de commande exécutent ainsi exactement le même code, et
il n'y a pas deux versions de la logique à maintenir.

Aucune dépendance à installer : tkinter est livré avec Python sous Windows.
"""

import os
import queue
import subprocess
import sys
import threading
from pathlib import Path

try:
    import tkinter as tk
    from tkinter import font as tkfont
    from tkinter import messagebox, ttk
except ImportError:
    # Linux minimal : tkinter est un paquet séparé. Message clair plutôt
    # qu'une trace d'erreur incompréhensible.
    sys.stderr.write(
        "tkinter est absent de cette installation Python.\n"
        "  Windows : réinstaller Python depuis python.org (tkinter est inclus)\n"
        "  Debian/Ubuntu : sudo apt install python3-tk\n"
        "  macOS : brew install python-tk\n\n"
        "Sans interface, la veille se lance en ligne de commande :\n"
        "  python veille.py\n"
    )
    sys.exit(1)

RACINE = Path(__file__).resolve().parent
VEILLE = RACINE / "veille.py"
BENCH = RACINE / "pipeline-bu" / "bench.csv"
ICONE = RACINE / "logo-hub4fix_v1_2025.ico"

FAMILLES = [
    ("all", "Toutes les sources"),
    ("forums", "Forums de réparation"),
    ("pieces", "Sites de pièces détachées"),
    ("marques", "Pages SAV des marques"),
    ("marketplaces", "Occasion (eBay)"),
]

# Palette reprise du site, pour que la fenêtre appartienne à la même maison.
IVOIRE = "#FAF8F5"
CREME = "#F3EEE8"
LIGNE = "#EDE6DC"
ENCRE = "#1C1A18"
TERRE = "#7A7268"
ROUGE = "#C8102E"
VERT = "#2D8B5E"


class Fenetre(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Veille Hub4Fix")
        self.geometry("880x640")
        self.minsize(700, 500)
        self.configure(bg=IVOIRE)

        if ICONE.exists():
            try:
                self.iconbitmap(str(ICONE))
            except Exception:
                pass  # .ico non supporté hors Windows : sans conséquence

        self.proc = None
        self.fil = queue.Queue()

        self._construire()
        self.after(100, self._vider_file)
        self.protocol("WM_DELETE_WINDOW", self._fermer)

    # ---------------------------------------------------------------- interface
    def _construire(self):
        police_titre = tkfont.Font(family="Georgia", size=19)
        police_ui = tkfont.Font(family="Segoe UI", size=10)
        police_mono = tkfont.Font(family="Consolas", size=9)

        entete = tk.Frame(self, bg=IVOIRE)
        entete.pack(fill="x", padx=22, pady=(18, 0))
        tk.Label(entete, text="Veille Hub⁴Fix", font=police_titre,
                 bg=IVOIRE, fg=ENCRE).pack(anchor="w")
        tk.Label(entete,
                 text="Banc d'essai : est-ce que la veille rapporte assez pour "
                      "justifier une automatisation ?",
                 font=police_ui, bg=IVOIRE, fg=TERRE, wraplength=800,
                 justify="left").pack(anchor="w", pady=(2, 0))

        tk.Frame(self, bg=LIGNE, height=1).pack(fill="x", padx=22, pady=14)

        # ---- paramètres ----
        params = tk.Frame(self, bg=IVOIRE)
        params.pack(fill="x", padx=22)

        tk.Label(params, text="Sources", font=police_ui, bg=IVOIRE,
                 fg=ENCRE).grid(row=0, column=0, sticky="w")
        self.var_source = tk.StringVar(value=FAMILLES[0][1])
        self.combo = ttk.Combobox(params, textvariable=self.var_source,
                                  values=[lbl for _, lbl in FAMILLES],
                                  state="readonly", width=28, font=police_ui)
        self.combo.grid(row=1, column=0, sticky="w", pady=(3, 0))

        tk.Label(params, text="Limite", font=police_ui, bg=IVOIRE,
                 fg=ENCRE).grid(row=0, column=1, sticky="w", padx=(20, 0))
        self.var_limite = tk.StringVar(value="")
        tk.Entry(params, textvariable=self.var_limite, width=7,
                 font=police_ui).grid(row=1, column=1, sticky="w",
                                      padx=(20, 0), pady=(3, 0))
        tk.Label(params, text="(vide = défaut)", font=("Segoe UI", 8),
                 bg=IVOIRE, fg=TERRE).grid(row=2, column=1, sticky="w",
                                           padx=(20, 0))

        self.var_sec = tk.BooleanVar(value=False)
        tk.Checkbutton(params, text="Essai à blanc (n'écrit rien)",
                       variable=self.var_sec, font=police_ui, bg=IVOIRE,
                       fg=ENCRE, activebackground=IVOIRE,
                       selectcolor="white").grid(row=1, column=2, sticky="w",
                                                 padx=(24, 0), pady=(3, 0))

        # ---- boutons ----
        barre = tk.Frame(self, bg=IVOIRE)
        barre.pack(fill="x", padx=22, pady=(16, 0))
        self.btn_lancer = tk.Button(barre, text="Lancer la veille",
                                    command=self._lancer, font=("Segoe UI", 10, "bold"),
                                    bg=ROUGE, fg="white", relief="flat",
                                    padx=18, pady=8, cursor="hand2",
                                    activebackground="#a50d26", activeforeground="white")
        self.btn_lancer.pack(side="left")
        self.btn_stop = tk.Button(barre, text="Interrompre", command=self._stopper,
                                  font=police_ui, bg=CREME, fg=TERRE,
                                  relief="flat", padx=14, pady=8, state="disabled")
        self.btn_stop.pack(side="left", padx=(8, 0))
        tk.Button(barre, text="Ouvrir le banc d'essai", command=self._ouvrir_bench,
                  font=police_ui, bg=CREME, fg=ENCRE, relief="flat",
                  padx=14, pady=8, cursor="hand2").pack(side="left", padx=(8, 0))

        self.lbl_etat = tk.Label(self, text="Prêt.", font=police_ui,
                                 bg=IVOIRE, fg=TERRE, anchor="w")
        self.lbl_etat.pack(fill="x", padx=22, pady=(12, 4))

        # ---- sortie ----
        cadre = tk.Frame(self, bg=LIGNE, bd=0)
        cadre.pack(fill="both", expand=True, padx=22, pady=(0, 18))
        self.sortie = tk.Text(cadre, font=police_mono, bg="white", fg=ENCRE,
                              relief="flat", wrap="none", padx=10, pady=8,
                              state="disabled")
        yscroll = tk.Scrollbar(cadre, command=self.sortie.yview)
        xscroll = tk.Scrollbar(cadre, orient="horizontal", command=self.sortie.xview)
        self.sortie.configure(yscrollcommand=yscroll.set, xscrollcommand=xscroll.set)
        self.sortie.grid(row=0, column=0, sticky="nsew")
        yscroll.grid(row=0, column=1, sticky="ns")
        xscroll.grid(row=1, column=0, sticky="ew")
        cadre.rowconfigure(0, weight=1)
        cadre.columnconfigure(0, weight=1)

        self.sortie.tag_configure("ok", foreground=VERT)
        self.sortie.tag_configure("ko", foreground=ROUGE)
        self.sortie.tag_configure("titre", foreground=ENCRE,
                                  font=("Consolas", 9, "bold"))

        self._ecrire("Choisir les paramètres puis « Lancer la veille ».\n")
        self._ecrire("Compter 2 secondes par requête : un passage complet "
                     "prend plusieurs minutes.\n")

    # ---------------------------------------------------------------- affichage
    def _ecrire(self, texte, tag=None):
        self.sortie.configure(state="normal")
        self.sortie.insert("end", texte, tag or "")
        self.sortie.see("end")
        self.sortie.configure(state="disabled")

    def _vider_file(self):
        """Seul le fil principal touche aux widgets — tkinter n'est pas
        thread-safe. Le fil de lecture dépose ses lignes ici."""
        try:
            while True:
                genre, ligne = self.fil.get_nowait()
                if genre == "ligne":
                    tag = None
                    if ligne.startswith("  ✓"):
                        tag = "ok"
                    elif ligne.startswith("  ✗") or "ERREUR" in ligne:
                        tag = "ko"
                    elif ligne.startswith("─") or ligne.startswith("═") or ligne.startswith(" "):
                        tag = "titre" if ligne.isupper() else None
                    self._ecrire(ligne, tag)
                elif genre == "fin":
                    self._terminer(ligne)
        except queue.Empty:
            pass
        self.after(120, self._vider_file)

    # ---------------------------------------------------------------- exécution
    def _arguments(self):
        args = []
        libelle = self.var_source.get()
        cle = next((c for c, l in FAMILLES if l == libelle), "all")
        if cle != "all":
            args += ["--source", cle]
        lim = self.var_limite.get().strip()
        if lim:
            if not lim.isdigit() or int(lim) < 1:
                messagebox.showwarning(
                    "Limite invalide",
                    "La limite doit être un nombre entier positif, "
                    "ou laissée vide pour le comportement par défaut.")
                return None
            args += ["--limit", lim]
        if self.var_sec.get():
            args.append("--sec")
        return args

    def _lancer(self):
        if self.proc is not None:
            return
        if not VEILLE.exists():
            messagebox.showerror(
                "veille.py introuvable",
                f"Attendu ici :\n{VEILLE}\n\n"
                "Cette fenêtre doit rester à la racine du dépôt, à côté de "
                "veille.py. Si vous avez copié le raccourci, ne déplacez pas "
                "les fichiers eux-mêmes.")
            return

        args = self._arguments()
        if args is None:
            return

        self.sortie.configure(state="normal")
        self.sortie.delete("1.0", "end")
        self.sortie.configure(state="disabled")

        # -u : sortie non tamponnée, sinon rien ne s'affiche avant la fin.
        cmd = [sys.executable, "-u", str(VEILLE)] + args
        self._ecrire(" ".join(cmd) + "\n\n", "titre")

        drapeaux = {}
        if os.name == "nt":
            # Évite la console noire qui clignote derrière la fenêtre.
            drapeaux["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)

        try:
            self.proc = subprocess.Popen(
                cmd, cwd=str(RACINE), stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                errors="replace", bufsize=1, **drapeaux)
        except Exception as e:
            messagebox.showerror("Lancement impossible", str(e))
            self.proc = None
            return

        self.btn_lancer.configure(state="disabled", bg=CREME, fg=TERRE)
        self.btn_stop.configure(state="normal", fg=ROUGE, cursor="hand2")
        self.lbl_etat.configure(text="Collecte en cours… (2 s entre chaque requête)",
                                fg=ENCRE)
        threading.Thread(target=self._lire, daemon=True).start()

    def _lire(self):
        """Fil de lecture : ne touche aucun widget, dépose dans la file."""
        proc = self.proc
        try:
            for ligne in proc.stdout:
                self.fil.put(("ligne", ligne))
        except Exception as e:
            self.fil.put(("ligne", f"\n[lecture interrompue] {e}\n"))
        code = proc.wait()
        self.fil.put(("fin", code))

    def _terminer(self, code):
        self.proc = None
        self.btn_lancer.configure(state="normal", bg=ROUGE, fg="white")
        self.btn_stop.configure(state="disabled", fg=TERRE, cursor="")
        if code == 0:
            self.lbl_etat.configure(text="Passage terminé.", fg=VERT)
        else:
            self.lbl_etat.configure(
                text=f"Terminé avec le code {code} — voir la sortie ci-dessus.",
                fg=ROUGE)

    def _stopper(self):
        if self.proc is None:
            return
        try:
            self.proc.terminate()
            self._ecrire("\n[interrompu par l'utilisateur]\n", "ko")
        except Exception:
            pass

    def _ouvrir_bench(self):
        if not BENCH.exists():
            messagebox.showinfo(
                "Banc d'essai vide",
                "Aucun passage enregistré pour l'instant.\n\n"
                "Le fichier apparaîtra après le premier lancement "
                "hors essai à blanc.")
            return
        try:
            if os.name == "nt":
                os.startfile(str(BENCH))  # noqa: S606
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(BENCH)])
            else:
                subprocess.Popen(["xdg-open", str(BENCH)])
        except Exception as e:
            messagebox.showerror("Ouverture impossible", f"{BENCH}\n\n{e}")

    def _fermer(self):
        if self.proc is not None:
            if not messagebox.askyesno(
                    "Collecte en cours",
                    "Un passage est en cours. Le fermer maintenant "
                    "l'interrompt. Continuer ?"):
                return
            try:
                self.proc.terminate()
            except Exception:
                pass
        self.destroy()


if __name__ == "__main__":
    Fenetre().mainloop()
