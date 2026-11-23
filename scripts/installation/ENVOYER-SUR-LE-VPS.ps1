# FWU — depuis un PC Windows : envoie ce dossier sur le VPS Oracle et lance l'installation.
# Clic droit sur ce fichier → « Exécuter avec PowerShell ».
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
Write-Host "FWU — envoi sur le VPS Oracle`n"
$vps = Read-Host "Adresse IP publique du VPS (console Oracle → Instances → ton instance)"
$key = Read-Host "Chemin de la clé SSH privée (.key / .pem) — fais glisser le fichier ici, ou Entrée si tu n'en as pas besoin"
$key = $key.Trim('"', "'", ' ')
$sshArgs = @()
if ($key) { $sshArgs = @("-i", $key) }
$target = "opc@$($vps.Trim())"
Write-Host "`nEnvoi des fichiers…"
& ssh @sshArgs $target "mkdir -p /home/opc/FWU-installation"
& scp @sshArgs (Get-ChildItem -File | Where-Object { $_.Extension -in ".zip", ".sh", ".md" } | ForEach-Object { $_.FullName }) "${target}:/home/opc/FWU-installation/"
if ($LASTEXITCODE -ne 0) { Write-Host "Envoi impossible : vérifie l'adresse et la clé."; Read-Host "Entrée pour fermer"; exit 1 }
Write-Host "`nLancement de l'installation sur le VPS…"
& ssh -t @sshArgs $target "bash /home/opc/FWU-installation/TOUT-INSTALLER.sh"
Read-Host "`nTerminé. Entrée pour fermer"
