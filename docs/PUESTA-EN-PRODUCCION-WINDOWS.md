# Puesta en producción en Windows

Esta guía instala Agenda técnica en una PC dedicada y la publica de forma segura. La aplicación y la API se sirven juntas desde Node.js; Caddy recibe las conexiones de Internet y aplica HTTPS.

## Requisitos

- Windows 11 Pro o Windows Server actualizado.
- Node.js 24 LTS.
- Una IP pública real. Si el proveedor usa CGNAT, hay que solicitar una IP pública o usar un túnel/VPN.
- Acceso al router para reservar una IP local fija para la PC y redirigir los puertos 80 y 443.
- Un nombre temporal de DNS dinámico apuntando a la IP pública. Puede reemplazarse luego por el dominio definitivo sin migrar datos.

No se debe publicar el puerto 5173 ni ejecutar `npm run dev` en producción.

## 1. Preparar la aplicación

Copiar el proyecto a una carpeta estable, por ejemplo `C:\AgendaPignus`, y abrir PowerShell allí:

```powershell
npm ci
npm run test
npm run build
```

Probar el servidor de producción:

```powershell
$env:PIGNUS_HOST='127.0.0.1'
$env:PIGNUS_PORT='3001'
$env:PIGNUS_SECURE_COOKIE='true'
npm start
```

La comprobación local `http://127.0.0.1:3001` debe mostrar la pantalla de acceso. Para una prueba local por HTTP hay que omitir temporalmente `PIGNUS_SECURE_COOKIE`; en el acceso real mediante HTTPS debe estar activo.

## 2. Configurar HTTPS con Caddy

Instalar Caddy como servicio de Windows y usar un `Caddyfile` como este, reemplazando el nombre temporal:

```caddyfile
agenda-ejemplo.ddns.net {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3001
}
```

Caddy administrará el certificado y redirigirá HTTP a HTTPS. El router debe redirigir TCP 80 y 443 hacia la IP local fija de la PC. En Windows Firewall sólo deben habilitarse esos dos puertos para Caddy; el puerto 3001 permanece local y no se redirige.

Ejemplo para crear las reglas desde PowerShell como administrador:

```powershell
New-NetFirewallRule -DisplayName 'Agenda PIGNUS HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443
New-NetFirewallRule -DisplayName 'Agenda PIGNUS HTTP certificado' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80
```

## 3. Arranque automático

Crear una tarea en el Programador de tareas que se ejecute al iniciar Windows, aunque ningún usuario haya iniciado sesión:

- Programa: ruta completa de `node.exe`.
- Argumentos: `server.cjs`.
- Directorio inicial: `C:\AgendaPignus`.
- Variables permanentes del sistema: `PIGNUS_HOST=127.0.0.1`, `PIGNUS_PORT=3001`, `PIGNUS_SECURE_COOKIE=true` y, si se desea separar los datos, `PIGNUS_DATA_DIR=D:\AgendaPignusData`.
- Activar “Reiniciar si se produce un error”.

Caddy también debe instalarse y ejecutarse como servicio. Desactivar la suspensión automática de la PC, mantener la hora de Windows sincronizada y configurar el reinicio posterior a cortes eléctricos desde BIOS/UEFI cuando esté disponible.

## 4. Datos y copias de seguridad

La base operativa está en `data\agenda-tecnica.db` o en `PIGNUS_DATA_DIR`. No debe quedar dentro de una carpeta sincronizada por OneDrive o Git.

Hacer una copia diaria con el servidor Node detenido momentáneamente y conservar varias generaciones en otro disco o equipo. La copia debe incluir `agenda-tecnica.db` y cualquier archivo `agenda-tecnica.db-wal` y `agenda-tecnica.db-shm` que aún exista.

Probar periódicamente una restauración en otra carpeta. Una copia que nunca fue restaurada no debe considerarse verificada.

## 5. Validación antes de habilitar usuarios

1. Abrir la URL HTTPS desde un teléfono usando datos móviles, no el Wi-Fi de la oficina.
2. Confirmar que el navegador no muestra advertencias de certificado.
3. Iniciar y cerrar sesión.
4. Guardar una agenda de prueba y confirmar que persiste después de reiniciar Node.
5. Verificar que `http://IP-PUBLICA:3001` no responde desde Internet.
6. Restaurar una copia de seguridad en una instalación de prueba.

## Cambio futuro al dominio definitivo

Sólo hay que apuntar el nuevo dominio a la IP pública y reemplazar la primera línea del `Caddyfile`. La base de datos y las agendas no se modifican.
