@echo off
setlocal
cd /d "%~dp0"
set "GIT=C:\Program Files\Git\cmd\git.exe"
if not exist "%GIT%" (
  echo Git est introuvable.
  pause
  exit /b 1
)
"%GIT%" add -A || goto :erreur
"%GIT%" diff --cached --quiet
if not errorlevel 1 (
  echo Rien de nouveau a publier.
  pause
  exit /b 0
)
set /p "MSG=Description de la modification : "
if not defined MSG set "MSG=Mise a jour du tableau de bord"
"%GIT%" commit -m "%MSG%" || goto :erreur
"%GIT%" push origin main || goto :erreur
echo.
echo Site publie avec succes.
echo http://192.168.1.251:8123/local/maison/index.html
pause
exit /b 0
:erreur
echo.
echo La publication a echoue. Lis le message ci-dessus.
pause
exit /b 1
