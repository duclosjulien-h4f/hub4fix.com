@echo off
REM Poste de recherche Hub4Fix. Double-clic : ouvre le navigateur sur l'outil.
cd /d "%~dp0"
where python >nul 2>nul && (python recherche.py & exit /b 0)
where py     >nul 2>nul && (py recherche.py & exit /b 0)
echo.
echo   Python introuvable. Installer depuis python.org
echo   en cochant "Add Python to PATH".
echo.
pause
