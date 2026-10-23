$ErrorActionPreference = 'Stop'
$stateDir = Join-Path $env:LOCALAPPDATA 'AgentecSoftguard'
if (-not (Test-Path -LiteralPath $stateDir)) { throw 'Primero instalar el conector.' }
Write-Host 'En Agentec: Abonados y clientes > Estado de sincronizacion > Generar clave de conexion.'
$token = Read-Host 'Pegar clave de conexion (oculta)' -AsSecureString
if ($token.Length -ne 64) { throw 'La clave debe tener 64 caracteres.' }
$credential = [System.Management.Automation.PSCredential]::new('connector', $token)
$credential | Export-Clixml -LiteralPath (Join-Path $stateDir 'connector.credential.xml')
Write-Host 'Clave cifrada guardada. Ejecutar node worker.cjs para probar antes de programar.'
