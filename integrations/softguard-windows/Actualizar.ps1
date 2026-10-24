# Run from an extracted release folder, using the Windows user of the connector.
$ErrorActionPreference = 'Stop'
$targetDir = 'C:\AgentecSoftguard'
$taskName = 'Agentec - Sincronizar SoftGuard'
$files = @('run.cjs', 'recovery.cjs', 'worker.cjs', 'lib.cjs', 'auth.cjs', 'lock.cjs', 'Bloqueo.ps1')
$handles = @()
$copied = @()
$wasEnabled = $false
$paused = $false
$backupDir = $null
$updateExitCode = 0
try {
    if ([IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') -eq [IO.Path]::GetFullPath($targetDir).TrimEnd('\')) {
        throw 'Extrae el ZIP en otra carpeta, por ejemplo Descargas, y ejecuta Actualizar.cmd desde alli.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $targetDir 'run.cjs'))) { throw 'No se encontro el conector instalado en C:\AgentecSoftguard.' }
    $nodeExe = (Get-Command node -ErrorAction Stop).Source
    foreach ($name in $files) {
        $source = Join-Path $PSScriptRoot $name
        if (-not (Test-Path -LiteralPath $source)) { throw "El paquete esta incompleto: $name" }
        if ($name.EndsWith('.cjs')) {
            & $nodeExe --check $source
            if ($LASTEXITCODE -ne 0) { throw "Archivo invalido: $name" }
        }
    }
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $taskIdentity = New-Object Security.Principal.NTAccount($task.Principal.UserId)
    if ($taskIdentity.Translate([Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value) {
        throw 'Ejecuta la actualizacion con el mismo usuario Windows que ejecuta la tarea.'
    }
    $wasEnabled = $task.Settings.Enabled
    Disable-ScheduledTask -InputObject $task | Out-Null
    $paused = $true
    Write-Host 'Esperando que termine cualquier sincronizacion activa...'
    $deadline = (Get-Date).AddMinutes(15)
    while ((Get-ScheduledTask -TaskName $taskName).State -eq 'Running') {
        if ((Get-Date) -gt $deadline) { throw 'La ejecucion sigue activa. No se reemplazaron archivos.' }
        Start-Sleep -Seconds 3
    }
    $stateDir = Join-Path $env:LOCALAPPDATA 'AgentecSoftguard'
    foreach ($name in @('queue.guard', 'run.guard')) {
        $handles += [IO.File]::Open((Join-Path $stateDir $name), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    }
    $backupDir = Join-Path $targetDir ('backups\' + [Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    foreach ($name in $files) {
        $destination = Join-Path $targetDir $name
        if (Test-Path -LiteralPath $destination) { Copy-Item -LiteralPath $destination -Destination (Join-Path $backupDir $name) }
        $copied += $name
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $destination -Force
        if ((Get-FileHash -LiteralPath $destination).Hash -ne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $name)).Hash) { throw "Fallo la verificacion de $name" }
    }
    Write-Host 'Conector actualizado. Se conservaron credenciales, configuracion y registros pendientes.'
    Write-Host 'La recuperacion automatica requiere la actualizacion de Agentec publicada. Los intentos antiguos sin comprobante aun requieren revision.'
} catch {
    Write-Host ('No se completo la actualizacion: ' + $_.Exception.Message)
    foreach ($name in $copied) {
        $previous = Join-Path $backupDir $name
        if (Test-Path -LiteralPath $previous) {
            try { Copy-Item -LiteralPath $previous -Destination (Join-Path $targetDir $name) -Force }
            catch { $wasEnabled = $false; Write-Host 'No se pudo restaurar un archivo. La tarea quedara pausada.' }
        }
    }
    $updateExitCode = 1
} finally {
    foreach ($handle in $handles) { $handle.Dispose() }
    if ($paused -and $wasEnabled) { Enable-ScheduledTask -TaskName $taskName | Out-Null; Write-Host 'Tarea automatica reactivada.' }
}
exit $updateExitCode
