# Lancer la veille depuis le bureau

Une fenêtre, un bouton, les paramètres réglables dedans. Rien à installer si
Python est déjà là : `tkinter` est livré avec Python sous Windows.

---

## Pourquoi pas un vrai `.exe`

Un `.exe` autonome se fabrique avec PyInstaller, qui doit tourner **sur
Windows** — il ne se compile pas de façon fiable depuis ailleurs. Or ce n'est
pas nécessaire : Windows lance les fichiers `.pyw` au double-clic, avec
`pythonw.exe` et donc **sans console noire**. Le résultat à l'usage est le
même, et il n'y a pas de binaire de 30 Mo à reconstruire à chaque
modification du script.

Si vous voulez malgré tout un `.exe` un jour, depuis votre machine :

```
pip install pyinstaller
pyinstaller --onefile --noconsole --icon logo-hub4fix_v1_2025.ico veille_gui.pyw
```

---

## Poser le raccourci sur le bureau

1. Ouvrir le dossier du dépôt (celui qui contient `veille.py`, `veille_gui.pyw`
   et `sauvegarde.ps1`)
2. Clic droit sur **`veille_gui.pyw`** → **Envoyer vers** → **Bureau (créer un
   raccourci)**
3. Sur le bureau, clic droit sur le raccourci → **Propriétés** → **Changer
   d'icône** → **Parcourir** → choisir `logo-hub4fix_v1_2025.ico` à la racine
   du dépôt
4. Renommer le raccourci « Veille Hub4Fix »

C'est tout. Double-clic, la fenêtre s'ouvre.

### Si le double-clic ne fait rien

L'association des `.pyw` est cassée — cela arrive quand Python a été installé
sans cocher les associations de fichiers. Faire le raccourci vers
**`Veille-Hub4Fix.bat`** à la place : il cherche `pythonw`, puis `py -w`, puis
`python`, et dit quoi faire si aucun n'est présent.

---

## Ce que fait la fenêtre

| Réglage | Effet |
|---|---|
| **Sources** | Toutes, ou une seule famille — utile pour creuser un problème sans attendre un passage complet |
| **Limite** | Plafonne le nombre de références ou de requêtes. Vide = comportement par défaut |
| **Essai à blanc** | Affiche tout mais n'écrit ni le vivier ni le banc d'essai |

Le bouton **Ouvrir le banc d'essai** ouvre `pipeline-bu/bench.csv` dans
Excel : une ligne par passage, c'est ce qui permet de comparer les matins.

La fenêtre ne collecte rien elle-même : elle lance `veille.py` et affiche sa
sortie au fil de l'eau. Donc la fenêtre et la ligne de commande exécutent
exactement le même code — pas deux versions à maintenir, pas de divergence
possible.

**Compter plusieurs minutes** pour un passage complet : le collecteur attend
2 secondes entre chaque requête, par correction envers les sites interrogés.
La fenêtre reste réactive pendant ce temps et le bouton « Interrompre »
fonctionne à tout moment.

---

## Prérequis

```
python --version
```

S'il ne répond rien, installer depuis **python.org** en cochant **« Add Python
to PATH »** pendant l'installation.

Rien d'autre : pas de `pip install`, aucune dépendance externe. Le collecteur
n'utilise que la bibliothèque standard.

---

## Si vous préférez ne rien installer

Le même passage se déclenche depuis GitHub, y compris du téléphone :

**Actions** → **« Pipeline BU — Collecte signaux rareté »** → **Run workflow**

Le compte rendu s'affiche dans le journal du run, et la ligne du jour est
reversée dans `bench.csv`. C'est le même `veille.py` qui tourne, sur un runner
qui a un accès réseau complet.

---

## Attention au dossier

La fenêtre cherche `veille.py` **à côté d'elle**. Vous pouvez déplacer le
*raccourci* où vous voulez ; ne déplacez pas les fichiers eux-mêmes hors du
dépôt. Si le cas se présente, la fenêtre le dit clairement au lieu d'échouer
en silence.
