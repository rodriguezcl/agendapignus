# Sincronizacion SoftGuard / Agentec para Windows

## Estado de esta entrega

Incluye sincronizacion horaria y solicitudes desde el boton Sincronizar abonados. La sincronizacion por navegador ya fue probada en la PC destino. El control remoto nuevo fue verificado con PostgreSQL aislado y pruebas simuladas; necesita publicar la plataforma y vincular esa PC para validarlo de extremo a extremo. No contiene credenciales.

## Actualizar la PC que ya funciona

1. Publicar primero los cambios de Agentec. El servidor crea la tabla privada de control en PostgreSQL; no requiere claves nuevas de Supabase.
2. En la PC destino, deshabilitar temporalmente la tarea Agentec - Sincronizar SoftGuard y esperar que termine su ejecucion actual.
3. Extraer el ZIP en C:\AgentecSoftguard reemplazando archivos. No borrar la carpeta completa ni node_modules. Las credenciales existentes quedan fuera de esta carpeta, en LOCALAPPDATA\AgentecSoftguard.
4. En Agentec, como administrador con permiso de importar, abrir Abonados y clientes > Estado de sincronizacion > Generar clave de conexion. Solo se muestra una vez; generar otra revoca la anterior. No compartir por chat.
5. En PowerShell, dentro de C:\AgentecSoftguard:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Conectar.ps1
node .\worker.cjs
```

Ingresar la clave en la terminal cuando la pida. Se guarda cifrada por Windows. La primera consulta puede ejecutar la sincronizacion horaria si corresponde: ya aplica importaciones si fueron habilitadas previamente.

6. Si termina bien, registrar la nueva modalidad:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Programar.ps1
```

Reemplaza solo la tarea del conector: consulta cada minuto y dos minutos despues del inicio de sesion. El servidor solicita una sincronizacion cada hora o cuando alguien presiona el boton. No se instala otra tarea horaria que duplique el trabajo.

7. Desde Agentec presionar Sincronizar abonados. Debe pasar de Pendiente a Sincronizando y luego Completada. El listado se actualiza al detectar una sincronizacion correcta. Si la PC no consulta durante tres minutos se muestra sin conexion reciente. Una solicitud pendiente vence en una hora; una ejecucion sin resultado vence en veinte minutos y no se repite automaticamente como el mismo trabajo.

## Requisitos y operacion

Windows, Chrome, Node.js 22 o superior. La tarea usa el mismo usuario Windows que guardo las credenciales; aprovecha el inicio automatico del escritorio y no requiere contrasena Windows. Puede bloquearse la pantalla, pero no cerrar sesion ni suspender la PC. La computadora debe tener Internet. No modifica totempignus ni abre puertos entrantes.

El conector recupera el acceso web cuando vence la sesion. Usar preferentemente una cuenta dedicada de Agentec con permisos de consulta e importacion: Agentec solo conserva una sesion por usuario, por lo que compartir la cuenta con una persona puede cerrar su sesion. La clave de conexion solo autoriza consultar trabajos y reportar resultados; no reemplaza el acceso web ni permite leer o importar clientes por si sola.

## Instalacion nueva o cambios de acceso

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Instalar.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Ejecutar.ps1 -Accion Credenciales
powershell -NoProfile -ExecutionPolicy Bypass -File .\Ejecutar.ps1 -Accion Prueba
powershell -NoProfile -ExecutionPolicy Bypass -File .\Ejecutar.ps1 -Accion Estado
```

Credenciales solicita usuario y contrasena de SoftGuard y Agentec en la terminal. Prueba descarga y valida sin confirmar importacion. Si informa preview-ok, Activar habilita las importaciones:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Ejecutar.ps1 -Accion Activar
```

Luego seguir los pasos de vinculacion anteriores. Sin clave de conexion, Programar.ps1 conserva el modo anterior de ejecucion directa cada hora.

## Diagnostico y seguridad

- Ejecutar.ps1 -Accion Estado muestra el ultimo resultado local. node run.cjs --diagnostic abre Chrome visible y nunca importa.
- El reporte debe estar completo, tener columnas Dealer/Cuenta y Nombre, solo cuentas PIG unicas y total igual al listado filtrado. No se fija en 1064: ese fue el total observado durante la instalacion.
- Tres intentos de descarga, pausas de 10 y 20 segundos. Confirma la ventana Exportar Reporte sin cambiar casillas. Si una contrasena se rechaza, termina la ejecucion sin insistir dentro de los reintentos.
- El importador conserva su respaldo, control de concurrencia y permisos. No elimina cuentas ausentes ni vincula reservas automaticamente. Una caida mayor al 10% frente al ultimo reporte importado requiere revision.
- pending-import.json bloquea la importacion si se perdio su confirmacion. Revisar auditoria antes de resolver ese marcador. remote-job.json conserva el resultado que falta comunicar al servidor: no borrarlo para reintentar una escritura.
- Un corte despues de iniciar un trabajo puede marcar WORKER_INTERRUPTED; no se presume exito ni se repite automaticamente la escritura incierta. Revisar el resultado en Agentec.
- El bloqueo exclusivo se libera al terminar el proceso. Los reportes temporales se eliminan al finalizar; un corte abrupto puede dejar carpetas download-* con datos sensibles. Retirarlas solo cuando no haya ejecucion activa.
- Las contrasenas se cifran con DPAPI para el mismo usuario y PC. No copiar el perfil ni los XML a otra PC. No se imprimen contrasenas ni contenido del reporte en los registros.
- Agentec muestra estado, ultimo contacto, ultima sincronizacion correcta y errores. No envia alertas por correo. Ante caidas de Internet o del sitio, vuelve a consultar en la proxima ejecucion. Cambios de clave, permisos o pantallas pueden requerir intervencion.

Para pausar, deshabilitar Agentec - Sincronizar SoftGuard en el Programador de tareas. Para volver a pruebas, establecer importEnabled:false en la configuracion local. No borrar datos del servidor al pausar.
