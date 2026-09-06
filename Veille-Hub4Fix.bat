@echo off
REM ---------------------------------------------------------------------------
REM Veille Hub4Fix — lanceur de secours.
REM
REM Le raccourci du bureau devrait pointer directement sur veille_gui.pyw :
REM Windows l'ouvre alors avec pythonw.exe, sans aucune console. Ce .bat sert
REM quand l'association du .pyw est cassee — ce qui arrive si Python a ete
REM installe sans cocher les associations de fichiers.
REM
REM Il se place lui-meme dans son dossier (%~dp0), donc le raccourci peut
REM vivre n'importe ou sur le bureau sans casser les chemins relatifs.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

REM pythonw d'abord : c'est l'interpreteur sans console, adapte a une fenetre.
where pythonw >nul 2>nul
if %errorlevel%==0 (
    start "" pythonw "veille_gui.pyw"
    exit /b 0
)

REM Lanceur officiel Windows, installe avec Python. -w = variante sans console.
where py >nul 2>nul
if %errorlevel%==0 (
    start "" py -w "veille_gui.pyw"
    exit /b 0
)

REM Dernier recours : python tout court. Une console restera visible.
where python >nul 2>nul
if %errorlevel%==0 (
    python "veille_gui.pyw"
    exit /b 0
)

echo.
echo   Python est introuvable sur cette machine.
echo.
echo   Installer depuis python.org en cochant "Add Python to PATH"
echo   pendant l'installation, puis relancer ce raccourci.
echo.
echo   Sans Python, la veille se declenche depuis GitHub :
echo     Actions -^> "Pipeline BU - Collecte signaux rarete" -^> Run workflow
echo.
pause
exit /b 1
