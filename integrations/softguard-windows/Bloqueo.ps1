param([Parameter(Mandatory=$true)][string]$Ruta)
$ErrorActionPreference = 'Stop'
try { $handle = [IO.File]::Open($Ruta, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
catch { [Console]::Out.WriteLine('LOCKED'); exit 1 }
try {
  [Console]::Out.WriteLine('READY')
  # EOF when the parent dies automatically releases the OS file lock.
  [Console]::In.ReadToEnd() | Out-Null
} finally { $handle.Dispose() }
