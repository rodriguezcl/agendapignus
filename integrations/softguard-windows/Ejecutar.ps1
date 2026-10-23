param([ValidateSet('Sincronizar','Sesiones','Prueba','Activar','Estado','Credenciales','Consultar')][string]$Accion = 'Sincronizar')
$ErrorActionPreference = 'Stop'
if ($Accion -eq 'Credenciales') { & (Join-Path $PSScriptRoot 'Credenciales.ps1'); exit }
$flags = @{ Sincronizar = @(); Sesiones = @('--login'); Prueba = @('--preview'); Activar = @('--enable'); Estado = @('--status') }
$nodePath = (Get-Command node -ErrorAction Stop).Source
if ($Accion -eq 'Consultar') { & $nodePath (Join-Path $PSScriptRoot 'worker.cjs'); exit $LASTEXITCODE }
Push-Location $PSScriptRoot
try {
  & $nodePath (Join-Path $PSScriptRoot 'run.cjs') @($flags[$Accion])
  exit $LASTEXITCODE
} finally { Pop-Location }
