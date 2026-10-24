# Notificaciones Web Push

La campana permite activar, desactivar y enviar una prueba desde **Notificaciones del dispositivo**. Es una suscripción voluntaria por navegador y usuario; no reemplaza los controles de sonido de la bandeja.

- Android: navegador compatible con Web Push, por ejemplo Chrome.
- iPhone/iPad: iOS/iPadOS 16.4 o posterior, aplicación agregada al inicio y abierta desde su icono.
- La primera activación solicita el permiso del sistema mediante un clic. No se solicita al iniciar sesión.
- El sistema operativo controla la presentación, el sonido y las restricciones de entrega. No se garantiza entrega instantánea ni que un modo de concentración permita mostrar el aviso.
- La primera suscripción toma los pendientes existentes como referencia silenciosa. Se avisan las novedades posteriores; abrir la bandeja no confirma cobranzas ni resuelve servicios.
- El cierre explícito de sesión revoca las suscripciones asociadas a esa sesión. El reemplazo de una sesión al ingresar en otro dispositivo también las revoca. La caducidad por inactividad permite seguir recibiendo avisos genéricos mientras la cuenta continúe activa.

## Servidor

`api/_lib/web-push.cjs` reutiliza el selector de la campana compilado por `scripts/build-push-notifications.cjs`, la proyección autorizada del estado y las consultas autorizadas de Tickets. Los permisos se comprueban en cada pasada; no se confían al navegador. Las cobranzas futuras, canceladas y reprogramadas siguen las reglas del selector compartido.

Un trabajo de `pg_cron` invoca `/api/push/process` cada minuto a través de `pg_net`. La credencial exclusiva está en Vault y se deriva del secreto de sesión con un contexto independiente. El proceso revisa hasta 100 dispositivos por pasada y tiene un presupuesto de 35 segundos, priorizando los que llevan más tiempo sin revisión. Los errores transitorios se reintentan a los dos minutos; 404/410 eliminan la suscripción vencida.

Las tablas `pignus_push_config` y `pignus_push_subscriptions` tienen RLS y no permiten acceso de `anon` ni `authenticated`. La clave privada VAPID permanece en el servidor. Los destinos se restringen a proveedores de push conocidos; nunca se aceptan URLs arbitrarias para solicitudes del servidor.

La exclusión temporal por dispositivo evita dos envíos simultáneos. Las identidades de avisos y el `tag` del sistema reducen duplicados; como en cualquier entrega externa, un fallo después del envío y antes de guardar su resultado puede causar un reintento. La carga útil no contiene nombres de clientes, importes, direcciones ni notas internas. El service worker no guarda páginas ni respuestas de la API en caché.

Al tocar el aviso, una ventana existente recibe un mensaje sin recargar formularios. La aplicación coteja la cuenta y busca el aviso en su bandeja autorizada antes de navegar. Un aviso resuelto o inaccesible no abre detalles antiguos.

## Preparación y despliegue

Requiere las extensiones `pg_cron`, `pg_net` y `supabase_vault` ya utilizadas por el programador de correo.

```powershell
node --env-file-if-exists=.env.local scripts/configure-web-push.cjs --prepare --url https://agendapignus.vercel.app/ --confirm
# Desplegar la aplicación; --prepare deja el envío pausado y conserva las claves existentes.
node --env-file-if-exists=.env.local scripts/configure-web-push.cjs --enable --confirm
node --env-file-if-exists=.env.local scripts/configure-web-push.cjs --status
```

`--enable` comprueba el endpoint y su credencial antes de activar el trabajo. `--disable --confirm` pausa los envíos. Tras rotar el secreto de sesión, volver a preparar y habilitar para actualizar Vault. No rotar las claves VAPID sin un plan para renovar las suscripciones existentes.

La verificación automatizada usa PostgreSQL aislado, proveedor simulado y navegador de escritorio con vistas móviles. La recepción real en cada teléfono requiere que su usuario lo active y use **Enviar prueba**.
