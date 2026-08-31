# Sincronización SoftGuard → Supabase → PIGNUS

## Alcance y barrera de seguridad

La implementación local no abre SQL Server a Internet y no conecta Vercel con el puerto 1433. El Worker se ejecuta dentro del servidor Windows, lee únicamente tres vistas y transmite snapshots por HTTPS. El navegador accede a los datos sólo mediante la sesión y los permisos de la API PIGNUS.

Las tablas `softguard_*` no escriben ni reemplazan `pignus_customers`.

## Flujo transaccional

1. El Worker abre una transacción SQL Server con aislamiento `SNAPSHOT` y lee las tres vistas.
2. Valida claves nulas, claves duplicadas y referencias huérfanas antes de enviar datos.
3. Crea un `sync_run_id`, informa los conteos y carga lotes de hasta 500 filas.
4. Cada solicitud lleva HMAC-SHA256, timestamp y nonce diferente. Los reintentos conservan el mismo `sync_run_id` y `batch_id`.
5. Supabase conserva los lotes en staging. Las tablas publicadas no cambian durante la recepción.
6. `softguard_finalize_sync` comprueba los conteos y referencias y, en una sola transacción, ejecuta upserts y bajas lógicas.
7. Si cualquier validación o lote falla, la versión publicada anteriormente permanece vigente.

Un snapshot sin abonados se rechaza por defecto para evitar una baja masiva accidental. `AllowEmptySubscriberSnapshot` sólo debe habilitarse durante una intervención aprobada y verificada.

## Prerrequisitos en SQL Server

Los nombres y vistas requeridos son:

- `[_Datos].[api].[vw_AbonadosPIG]`, clave `IdInterno`.
- `[_Datos].[api].[vw_ZonasPIG]`, clave `IdInternoZona` y relación `IdInternoAbonado`.
- `[_Tablas].[api].[vw_TiposServicio]`, clave `CodigoTipoServicio`.

El Worker exige aislamiento `SNAPSHOT` para que las tres lecturas formen una versión consistente. Un DBA debe verificar `snapshot_isolation_state_desc` en `_Datos` y `_Tablas`. Si no está habilitado, el Worker falla sin transmitir ni publicar datos. Habilitarlo es una acción administrativa fuera de esta implementación local y debe evaluarse con el responsable de SoftGuard.

Validación confirmada el 30/08/2026 directamente en SoftGuard:

- `_Datos` y `_Tablas` tienen `SNAPSHOT_ISOLATION = ON` y `READ_COMMITTED_SNAPSHOT = ON`.
- El snapshot contenía 1043 abonados, 4477 zonas y 12 tipos de servicio después de la normalización.
- No existían claves nulas o duplicadas, zonas huérfanas ni tipos de servicio huérfanos.
- `IdInternoZona`, proveniente de `zon_idKey`, es la clave estable utilizada para cada zona.

Estos conteos son una línea base operativa, no valores fijos del Worker. Cada ejecución anuncia y valida los conteos de su propio snapshot completo.

La vista de abonados normaliza el tipo original `NULL` o `0` como `CodigoTipoServicio = 0`. El catálogo de `_Tablas.api.vw_TiposServicio` contiene la fila `0 / Sin especificar`. El Worker trata `"0"` como una clave válida, exige que tenga correspondencia en el catálogo y no la convierte en `NULL` durante el envío o la publicación.

Ejecutar [validate-softguard-views.sql](sql-server/validate-softguard-views.sql) con una identidad de auditoría de solo lectura. Todos los conteos de errores deben ser cero, incluida la presencia exacta de la fila normalizada `0 / Sin especificar`. El Worker repite las validaciones de claves y referencias en memoria en cada ejecución.

El servidor `SRV-SOFTGUARD` pertenece a `WORKGROUP`. La identidad definitiva es la cuenta virtual de servicio `NT SERVICE\PignusSoftGuardSync`, asociada al servicio Windows `PignusSoftGuardSync`. No requiere contraseña y sólo puede utilizarse localmente para ese servicio.

Primero se crea el servicio en estado detenido y con inicio manual. Sólo entonces se aplica [grant-softguard-read.sql](sql-server/grant-softguard-read.sql) en modo SQLCMD, porque SQL Server puede no reconocer la cuenta virtual antes de que exista el servicio. El script crea un login Windows en la instancia y usuarios exclusivamente en `_Datos` y `_Tablas`. No agrega la identidad a `sysadmin`, `db_owner` o `db_datareader`, no crea usuarios en otras bases y concede solamente:

- `SELECT` sobre `_Datos.api.vw_AbonadosPIG`.
- `SELECT` sobre `_Datos.api.vw_ZonasPIG`.
- `SELECT` sobre `_Tablas.api.vw_TiposServicio`.

No se concede acceso a las tablas originales ni ningún permiso de escritura. Si la identidad ya tuviera cualquier rol o permiso explícito distinto de esos tres `SELECT`, el script falla de forma segura y exige una revisión administrativa; no revoca ni modifica silenciosamente permisos preexistentes.

## Configuración del Worker

Nunca completar el secreto real en `appsettings.json`. Configurar para la identidad del servicio:

- `Sync__Endpoint`: URL HTTPS de `softguard-sync`.
- `Sync__SqlConnectionString`: conexión con `Initial Catalog=_Datos`, `Integrated Security=true`, `Encrypt=true` y `TrustServerCertificate=false`.
- `Sync__Secret`: secreto HMAC actual, con al menos 32 bytes aleatorios.
- `Sync__IntervalSeconds`: `60` de forma predeterminada.
- `Sync__BatchSize`: `250` de forma predeterminada y máximo `500`.

El archivo [appsettings.example.json](../workers/SoftGuard.Sync/appsettings.example.json) contiene únicamente marcadores. Las variables pueden almacenarse como variables de entorno de máquina restringidas a administradores; para mayor aislamiento, configurarlas en el entorno propio del servicio y proteger la clave de registro del servicio con ACL de Windows.

El Worker nunca necesita `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` ni una clave administrativa.

## Publicación e instalación como servicio Windows

En una estación con SDK .NET 8:

```powershell
dotnet test .\workers\SoftGuard.Sync.Tests\SoftGuard.Sync.Tests.csproj -c Release
dotnet publish .\workers\SoftGuard.Sync\SoftGuard.Sync.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=None -p:DebugSymbols=false -o .\artifacts\softguard-sync-release
```

La publicación de archivo único incorpora el runtime y el ensamblado administrado del Worker dentro del ejecutable. Esto reduce archivos y evita depender de un runtime instalado. Si el servidor aplica AppLocker o Windows Defender Application Control, el administrador debe validar o firmar el ejecutable antes de instalar el servicio; no se debe debilitar la política del servidor.

Copiar el artefacto a `C:\Program Files\Pignus\SoftGuardSync`, con escritura permitida sólo a `SYSTEM` y administradores y lectura/ejecución para `NT SERVICE\PignusSoftGuardSync`. La instalación detallada y sus comandos exactos están en [Instalación del Worker en SRV-SOFTGUARD](#instalación-del-worker-en-srv-softguard).

Configurar recuperación para reiniciar el servicio tras fallos y verificar en el Visor de eventos:

- inicio y finalización;
- duración;
- `sync_run_id`;
- cantidades por entidad;
- códigos de error sin nombres, teléfonos, direcciones ni secretos.

El semáforo global `Global\PignusSoftGuardSync` impide ejecuciones simultáneas en el mismo servidor.

## Instalación del Worker en SRV-SOFTGUARD

Ejecutar los pasos siguientes en PowerShell **como administrador**, directamente en `SRV-SOFTGUARD`. No ejecutarlos desde la notebook. Los comandos presuponen que SQL Server usa la instancia predeterminada, cuyo servicio Windows es `MSSQLSERVER`, coherente con la conexión `Server=SRV-SOFTGUARD` sin nombre de instancia.

### 1. Copiar archivos y crear el servicio inicialmente detenido

Después de verificar los hashes del ZIP, extraer su contenido y ubicar los cuatro archivos publicados en `C:\Program Files\Pignus\SoftGuardSync`. Luego ejecutar:

```powershell
$serviceName = 'PignusSoftGuardSync'
$installPath = 'C:\Program Files\Pignus\SoftGuardSync'
$executable = Join-Path $installPath 'Pignus.SoftGuard.Sync.exe'

Get-Service -Name 'MSSQLSERVER' -ErrorAction Stop
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "No existe el ejecutable: $executable"
}

sc.exe create $serviceName binPath= ('"{0}"' -f $executable) start= demand obj= "NT SERVICE\$serviceName" DisplayName= 'Pignus SoftGuard Sync'
if ($LASTEXITCODE -ne 0) { throw "sc.exe create falló con código $LASTEXITCODE" }

sc.exe sidtype $serviceName unrestricted
if ($LASTEXITCODE -ne 0) { throw "sc.exe sidtype falló con código $LASTEXITCODE" }

sc.exe config $serviceName depend= MSSQLSERVER
if ($LASTEXITCODE -ne 0) { throw "sc.exe config depend falló con código $LASTEXITCODE" }

sc.exe failure $serviceName reset= 86400 actions= restart/60000/restart/60000/restart/300000
if ($LASTEXITCODE -ne 0) { throw "sc.exe failure falló con código $LASTEXITCODE" }

sc.exe failureflag $serviceName 1
if ($LASTEXITCODE -ne 0) { throw "sc.exe failureflag falló con código $LASTEXITCODE" }

icacls $installPath /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' "NT SERVICE\${serviceName}:(OI)(CI)RX"
if ($LASTEXITCODE -ne 0) { throw "icacls falló con código $LASTEXITCODE" }

Get-CimInstance Win32_Service -Filter "Name='$serviceName'" |
    Select-Object Name, State, StartMode, StartName, PathName
```

El resultado esperado en este punto es `State = Stopped`, `StartMode = Manual` y `StartName = NT SERVICE\PignusSoftGuardSync`. No iniciar todavía el servicio.

### 2. Registrar la identidad en SQL Server

Copiar `docs\sql-server\grant-softguard-read.sql` al servidor y ejecutarlo con una cuenta administradora de SQL Server que use autenticación integrada:

```powershell
sqlcmd -S 'SRV-SOFTGUARD' -E -b -i 'C:\Install\Pignus\grant-softguard-read.sql'
if ($LASTEXITCODE -ne 0) { throw "La asignación de permisos SQL falló con código $LASTEXITCODE" }
```

Revisar la salida: `is_sysadmin` debe ser `0`, las membresías `db_owner` y `db_datareader` deben estar ausentes y los únicos permisos directos deben ser los tres `GRANT SELECT` documentados. El script no debe ejecutarse antes de crear el servicio ni durante esta revisión local.

### 3. Configurar endpoint, conexión y secreto

La configuración se almacena en el entorno privado del servicio. El secreto se solicita de forma interactiva para que no quede escrito en el historial de PowerShell. El primer intervalo se fija en 24 horas: la primera ejecución será inmediata, pero no habrá otra antes de detener y revisar el servicio.

```powershell
$serviceName = 'PignusSoftGuardSync'
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName"
$endpoint = Read-Host 'Endpoint HTTPS de softguard-sync'
$endpointUri = $null
if (-not [Uri]::TryCreate($endpoint, [UriKind]::Absolute, [ref]$endpointUri) -or $endpointUri.Scheme -ne 'https') {
    throw 'El endpoint debe ser una URL HTTPS absoluta.'
}
$secretSecure = Read-Host 'Secreto HMAC actual (mínimo 32 caracteres)' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretSecure)

try {
    $secretPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    if ($secretPlain.Length -lt 32) { throw 'El secreto HMAC debe tener al menos 32 caracteres.' }

    $serviceEnvironment = @(
        "Sync__Endpoint=$endpoint"
        'Sync__SqlConnectionString=Server=SRV-SOFTGUARD;Initial Catalog=_Datos;Integrated Security=true;Encrypt=true;TrustServerCertificate=false;Application Name=Pignus SoftGuard Sync'
        "Sync__Secret=$secretPlain"
        'Sync__IntervalSeconds=86400'
        'Sync__BatchSize=250'
        'Sync__HttpTimeoutSeconds=45'
        'Sync__SqlCommandTimeoutSeconds=60'
        'Sync__MaxRetries=5'
        'Sync__AllowEmptySubscriberSnapshot=false'
    )
    New-ItemProperty -LiteralPath $serviceKey -Name Environment -PropertyType MultiString -Value $serviceEnvironment -Force | Out-Null
}
finally {
    if ($secretPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
    $secretPlain = $null
    $secretSecure.Dispose()
}

$acl = [Security.AccessControl.RegistrySecurity]::new()
$acl.SetOwner([Security.Principal.NTAccount]::new('BUILTIN\Administrators'))
$acl.AddAccessRule([Security.AccessControl.RegistryAccessRule]::new('SYSTEM','FullControl','ContainerInherit','None','Allow'))
$acl.AddAccessRule([Security.AccessControl.RegistryAccessRule]::new('BUILTIN\Administrators','FullControl','ContainerInherit','None','Allow'))
Set-Acl -LiteralPath $serviceKey -AclObject $acl
```

No colocar el secreto en `appsettings.json`, logs, tickets ni Git. La cuenta virtual no necesita contraseña. La cadena usa autenticación integrada y validación estricta del certificado SQL Server; si el certificado no es confiable, se debe corregir su cadena de confianza, no habilitar `TrustServerCertificate=true`.

### 4. Ejecutar una sincronización controlada

```powershell
Start-Service -Name 'PignusSoftGuardSync'
Get-Service -Name 'PignusSoftGuardSync'
```

La sincronización comienza inmediatamente. Revisar el Visor de eventos y confirmar una finalización correcta, los conteos esperados y el `sync_run_id`, sin datos personales ni secretos. Ante cualquier error, detener el servicio y conservar el snapshot anterior:

```powershell
Stop-Service -Name 'PignusSoftGuardSync'
```

Aunque la primera ejecución finalice correctamente, detener el servicio antes del paso siguiente para que la activación periódica sea deliberada.

### 5. Habilitar inicio automático y ejecución periódica

Sólo después de aprobar la sincronización controlada, sustituir `60` por el intervalo operativo acordado, en segundos:

```powershell
$serviceName = 'PignusSoftGuardSync'
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName"
$environment = @((Get-ItemProperty -LiteralPath $serviceKey -Name Environment).Environment)
if (-not ($environment -like 'Sync__IntervalSeconds=*')) {
    throw 'No se encontró Sync__IntervalSeconds en el entorno del servicio.'
}
$environment = $environment | ForEach-Object {
    if ($_ -like 'Sync__IntervalSeconds=*') { 'Sync__IntervalSeconds=60' } else { $_ }
}
Set-ItemProperty -LiteralPath $serviceKey -Name Environment -Value $environment

sc.exe config $serviceName start= auto
if ($LASTEXITCODE -ne 0) { throw "No se pudo habilitar el inicio automático: $LASTEXITCODE" }

Start-Service -Name $serviceName
Get-CimInstance Win32_Service -Filter "Name='$serviceName'" |
    Select-Object Name, State, StartMode, StartName, PathName
```

El estado final esperado es `Running`, `StartMode = Auto`, identidad `NT SERVICE\PignusSoftGuardSync`, dependencia de `MSSQLSERVER` y recuperación configurada. Para auditar dependencia y recuperación:

```powershell
sc.exe qc PignusSoftGuardSync
sc.exe qfailure PignusSoftGuardSync
```

## Variables de la Edge Function

- `SOFTGUARD_SYNC_SECRET_CURRENT`: secreto compartido actual.
- `SOFTGUARD_SYNC_SECRET_PREVIOUS`: secreto anterior, sólo durante rotación.
- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`: permanecen en el entorno administrado de la función.

La función se configura con `verify_jwt = false` porque el Worker no posee un JWT de usuario. Esto no la deja anónima: exige HMAC, timestamp dentro de cinco minutos, nonce UUID de un solo uso, límite de solicitudes, cuerpo máximo de 1 MB y lotes de 500 registros.

## Integración con PIGNUS

`GET /api/softguard/abonados` exige sesión y alguno de los permisos `accounts`, `agenda`, `weekly` o `history`. Sólo devuelve registros activos, con tipo de servicio y zonas activas. Admite `search`, `limit` (máximo 100) y `offset`.

El frontend utiliza `apiClient.searchSoftguardSubscribers`; no contiene cliente Supabase ni claves. No se agregó una pantalla nueva: el punto natural de integración posterior es el selector de abonados de Agenda/Abonados, respetando el diseño existente.

## Rotación de secretos

1. Generar un secreto nuevo fuera de chats, Git y logs.
2. Mantener el secreto vigente como `PREVIOUS` y cargar el nuevo como `CURRENT` en la función.
3. Actualizar `Sync__Secret` en el servidor y reiniciar el Worker.
4. Confirmar una sincronización completa.
5. Eliminar `PREVIOUS` de la función.

Los pasos que cambian secretos remotos o despliegan la función requieren Aprobación 2.

## Aprobación 2 por fases

La autorización remota se divide en fases independientes. Cada fase se detiene, presenta sus verificaciones y requiere autorización antes de comenzar la siguiente:

1. **Fase 2A — baseline y migración de Supabase.** Registrar `202608250001` como aplicada mediante el historial oficial sin ejecutar su SQL; realizar `supabase db push --dry-run`; exigir que proponga exclusivamente `202608300001_softguard_sync.sql`; solicitar autorización y recién entonces aplicar esa migración. Verificar siete tablas, cinco funciones, RLS y permisos antes de detenerse.
2. **Fase 2B — secretos y Edge Function.** Configurar secretos administrados sin mostrarlos y desplegar solamente `softguard-sync`. Ejecutar pruebas negativas de autenticación, repetición, timestamp, tamaño y frecuencia. Detenerse antes de tocar Vercel.
3. **Fase 2C — API y Vercel.** Confirmar la rama de producción y si la integración Git despliega automáticamente; desplegar la API autenticada; verificar que el navegador no consulta Supabase y que la ruta devuelve una colección vacía antes del primer snapshot. Detenerse antes de instalar el Worker.
4. **Fase 2D — servicio Windows y primera sincronización.** Crear el servicio detenido, ejecutar `grant-softguard-read.sql`, configurar endpoint/conexión/secreto, realizar una sincronización controlada, verificar conteos y normalización y detenerse. El inicio automático y periódico se habilita sólo después de una validación final explícita.

Una aprobación de una fase no autoriza ninguna de las siguientes. Un resultado inesperado, una migración adicional en el dry-run o una discrepancia de permisos cancela la fase antes de nuevas escrituras.

## Actualización, recuperación y diagnóstico

- Antes de actualizar, detener el servicio y conservar el binario/configuración anterior sin secretos exportados.
- Publicar en una carpeta versionada, conservar la anterior y cambiar la ruta del servicio sólo después de las pruebas.
- Si una ejecución queda en `receiving` o `failed`, no finaliza ni desactiva registros. Puede diagnosticarse por `sync_run_id` y descartarse posteriormente mediante una tarea de mantenimiento aprobada.
- Ante `SYNC_DUPLICATE_KEY_OR_BATCH`, ejecutar las consultas de validación sobre las vistas; no corregir el dato dentro del Worker.
- Ante errores de certificado, corregir la cadena de confianza. No usar `TrustServerCertificate=true` ni deshabilitar HTTPS.
- Ante error de aislamiento snapshot, coordinar con el DBA. No degradar silenciosamente a lecturas inconsistentes.

## Plan de reversión

1. Detener y deshabilitar el Worker. La aplicación conservará el último snapshot publicado.
2. Revertir el uso de `apiClient.searchSoftguardSubscribers` o la ruta API si se hubiera integrado en una pantalla.
3. Revertir la Edge Function al despliegue anterior.
4. Conservar las tablas `softguard_*` para diagnóstico; no borrarlas automáticamente.
5. Sólo con respaldo y aprobación explícita, eliminar funciones y tablas en orden: staging/nonces/batches, zonas, abonados, tipos, sincronizaciones.

La migración no modifica tablas `pignus_*`, por lo que la agenda y `pignus_customers` continúan funcionando durante la reversión.
