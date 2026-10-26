# Publie depuis le PC Windows : envoie le dossier HomeDashboard vers le dépôt OpenClaw (CT 104),
# puis y lance deploy/deploy.sh (qui copie dans Home Assistant et vérifie).
# Prérequis (une fois) : clé SSH du PC ajoutée à ~openclaw/.ssh/authorized_keys sur 192.168.1.231.
# Usage : powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1
$ErrorActionPreference = 'Stop'
$Remote = 'openclaw@192.168.1.231'
$Repo = '.openclaw/workspace/homedashboard'
Set-Location (Split-Path -Parent $PSScriptRoot)

scp -r index.html styles.css README.md js "${Remote}:${Repo}/"
if ($LASTEXITCODE) { throw 'Copie vers OpenClaw échouée' }
ssh $Remote "cd $Repo && git status --short -- . && deploy/deploy.sh"
if ($LASTEXITCODE) { throw 'Déploiement échoué' }
