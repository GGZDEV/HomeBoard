@echo off
setlocal EnableExtensions
set "PROJECT=C:\Users\guill\Desktop\HomeDashboard"
set "BACKUP=C:\Users\guill\Desktop\HomeDashboard-backup-before-git"
set "GIT=C:\Program Files\Git\cmd\git.exe"
set "KEY=C:\Users\guill\.ssh\homedashboard_ed25519"
set "REGISTER=http://100.76.111.11:8768/register/9d44a14bb512039570f099676c3789c7"

if not exist "%GIT%" (
  echo Git est introuvable.
  pause
  exit /b 1
)
if not exist "%PROJECT%\index.html" (
  echo Le projet est introuvable : %PROJECT%
  pause
  exit /b 1
)

if not exist "%BACKUP%" (
  echo Sauvegarde de la version locale actuelle...
  robocopy "%PROJECT%" "%BACKUP%" /E /XD .git /NFL /NDL /NJH /NJS >nul
)

if not exist "%USERPROFILE%\.ssh" mkdir "%USERPROFILE%\.ssh"
if not exist "%KEY%" (
  echo Creation de la cle de deploiement...
  "%WINDIR%\System32\OpenSSH\ssh-keygen.exe" -q -t ed25519 -N "" -C homedashboard-pcguigz -f "%KEY%" || goto :erreur
)
icacls "%KEY%" /inheritance:r /grant:r "%USERNAME%:R" >nul

echo Autorisation de cette cle sur le serveur...
"%WINDIR%\System32\curl.exe" -fsS -X POST --data-binary "@%KEY%.pub" "%REGISTER%" || goto :erreur

cd /d "%PROJECT%"
if not exist .git "%GIT%" init || goto :erreur
"%GIT%" branch -M main || goto :erreur
"%GIT%" remote get-url origin >nul 2>nul
if errorlevel 1 (
  "%GIT%" remote add origin openclaw@100.76.111.11:/home/openclaw/git/homedashboard.git || goto :erreur
) else (
  "%GIT%" remote set-url origin openclaw@100.76.111.11:/home/openclaw/git/homedashboard.git || goto :erreur
)
"%GIT%" config core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe -i C:/Users/guill/.ssh/homedashboard_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" || goto :erreur
"%GIT%" config user.name >nul 2>nul || "%GIT%" config user.name Ggz
"%GIT%" config user.email >nul 2>nul || "%GIT%" config user.email ggz@local

echo Synchronisation avec le serveur...
"%GIT%" fetch origin main || goto :erreur
"%GIT%" reset --hard origin/main || goto :erreur
"%GIT%" branch --set-upstream-to=origin/main main || goto :erreur

"%GIT%" config --get homedashboard.setupDone >nul 2>nul
if errorlevel 1 (
  echo Test complet du git push et du deploiement...
  "%GIT%" commit --allow-empty -m "Verifie le deploiement depuis PCGUIGZ" || goto :erreur
  "%GIT%" push origin main || goto :erreur
  "%GIT%" config homedashboard.setupDone true
)

echo.
echo Installation terminee.
echo Pour publier ensuite : double-clique sur publier.cmd dans HomeDashboard.
pause
exit /b 0

:erreur
echo.
echo L'installation a echoue. Lis le message ci-dessus.
pause
exit /b 1
