$ErrorActionPreference = 'Stop'
$installDir = $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$remote = Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'AgentecSoftguard\connector.credential.xml')
if ($remote) {
  $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $installDir 'Ejecutar.ps1') + '" -Accion Consultar'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $installDir
  $hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
} else {
  $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $installDir 'Ejecutar.ps1') + '"'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $installDir
  $hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
}
$logon = New-ScheduledTaskTrigger -AtLogOn -User $identity
$logon.Delay = 'PT2M'
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Agentec - Sincronizar SoftGuard' -Action $action -Trigger @($hourly,$logon) -Principal $principal -Settings $settings -Force | Out-Null
if ($remote) { Write-Host 'Control remoto configurado: consulta cada minuto; sincronizacion horaria gestionada por Agentec.' }
else { Write-Host "Tarea configurada sin contrasena para $identity, cada hora y al iniciar sesion." }
Write-Host 'La sesion puede quedar bloqueada, pero no debe cerrarse. La PC debe seguir encendida y sin suspension.'
Get-ScheduledTask -TaskName 'Agentec - Sincronizar SoftGuard' | Select-Object TaskName,State
