# Publie les commits locaux vers le dépôt HomeDashboard.
# Le serveur reçoit le push, teste les fichiers puis déploie automatiquement dans Home Assistant.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

git push origin main
if ($LASTEXITCODE) { throw 'Publication échouée' }
