param([ValidateSet('Guardar','Leer')][string]$Accion = 'Guardar', [ValidateSet('softguard','agentec','connector')][string]$Sitio = 'softguard')
$ErrorActionPreference = 'Stop'
$stateDir = Join-Path $env:LOCALAPPDATA 'AgentecSoftguard'
if (-not (Test-Path -LiteralPath $stateDir)) { throw 'Primero ejecutar Instalar.ps1.' }
if ($Accion -eq 'Guardar') {
  foreach ($service in @('softguard','agentec')) {
    Write-Host "Acceso automatico a $service"
    $serviceUser = Read-Host 'Usuario o correo'
    $servicePassword = Read-Host 'Contrasena (oculta)' -AsSecureString
    $credential = [System.Management.Automation.PSCredential]::new($serviceUser, $servicePassword)
    if (-not $credential -or -not $credential.UserName -or $credential.Password.Length -eq 0) { throw 'Carga cancelada o incompleta.' }
    $credential | Export-Clixml -LiteralPath (Join-Path $stateDir "$service.credential.xml")
  }
  Write-Host 'Accesos guardados con cifrado de Windows para este usuario y esta PC.'
} else {
  # Private child-process pipe consumed by Node; never run this mode in a console.
  try {
    $credential = Import-Clixml -LiteralPath (Join-Path $stateDir "$Sitio.credential.xml")
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    @{ username = $credential.UserName; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
  } catch { [Console]::Error.WriteLine('CREDENTIALS_UNAVAILABLE'); exit 1 }
}
