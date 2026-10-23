param([switch]$Programar)
$ErrorActionPreference = 'Stop'
$installDir = $PSScriptRoot
$stateDir = Join-Path $env:LOCALAPPDATA 'AgentecSoftguard'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$nodeMajor = & $nodePath -p 'parseInt(process.versions.node)'
if ([int]$nodeMajor -lt 22) { throw 'Se requiere Node.js 22 o superior.' }
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
# The browser profile contains authenticated sessions. Only this Windows user
# and SYSTEM may access the connector state. Do not change the totem directory.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $stateDir /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron proteger las sesiones del conector.' }
Push-Location $installDir
try {
  & npm.cmd ci --omit=dev --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' }
} finally { Pop-Location }
$configPath = Join-Path $stateDir 'config.json'
if (-not (Test-Path -LiteralPath $configPath)) { Copy-Item -LiteralPath (Join-Path $installDir 'config.example.json') -Destination $configPath }
if ($Programar) {
  foreach ($site in @('softguard','agentec')) {
    if (-not (Test-Path -LiteralPath (Join-Path $stateDir "$site.credential.xml"))) { throw 'Primero configurar Credenciales y realizar Prueba.' }
  }
  & (Join-Path $PSScriptRoot 'Programar.ps1')
}
Write-Host 'Instalado. Ejecutar Credenciales, luego Prueba y finalmente Activar con Ejecutar.ps1.'

