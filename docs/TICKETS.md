# Tickets de Agentec

Implementación: 22/10/2026. Reemplaza la bandeja visible de Seguimientos. No importa datos, conversaciones ni números de Zammad.

## Uso y reglas

- Un caso recibe un número inmutable `Ticket#1000001`. La secuencia inicial es configurable antes de emitir el primer número; mínimo cinco dígitos, sin reinicio al cambiar de año. No se afirma que el rango no coincida con Zammad: son sistemas independientes.
- Reclamo telefónico: cuenta obligatoria, categoría/subcategoría, evento y zona cuando corresponden, observación y adjuntos. Una solicitud interna admite cuenta opcional según la categoría.
- La cuenta seleccionada muestra casos abiertos dentro del alcance del usuario. Se puede revisar un caso, sumar información o confirmar que es distinto. La creación vuelve a comprobar coincidencias y exige una confirmación vigente. No se fusiona sólo por compartir una cuenta.
- Las observaciones conservan autor, fecha, canal, visibilidad y adjuntos. Agregar información no envía un correo. Las notas internas requieren permiso adicional y nunca se incluyen automáticamente en una respuesta.
- Estados: Nuevo, En gestión, En espera, Resuelto y Fusionado. Resolver requiere responsable y resultado; reabrir exige motivo. La espera admite fecha de revisión. Abrir una notificación no resuelve el caso.
- Una fusión requiere permiso y confirmación, y conserva las referencias originales, autores, archivos y vínculos. El principal mantiene su número. Fusionado es un archivo de referencia, no otro caso activo.
- Vincular servicios existentes requiere acceso al servicio y coincidencia de la cuenta. La visita se planifica con las reglas habituales de Agenda; completar la visita no resuelve el ticket.
- En el informe técnico, Solicitar acción / seguimiento guarda la solicitud junto con el resultado del servicio. Si se identifica un caso abierto, se incorpora el aporte conservando su autor. Si ya no es accesible o está cerrado cuando se incorpora, se conserva la solicitud como un caso nuevo. Nueva solicitud en la ficha permite registrar otro caso del mismo servicio.

## Persistencia y concurrencia

`api/_lib/tickets.cjs` contiene las reglas; `tickets-store.cjs`, las transacciones; `tickets-http.cjs`, el transporte compartido por PostgreSQL y SQLite. `src/features/tickets` contiene la bandeja, los formularios y la administración.

Las tablas `pignus_ticket_*` están separadas del documento de estado de Agenda. No se sobrescriben al guardar roles, servicios o clientes. Las conversaciones y archivos no viajan en el listado: hay paginación SQL, DTO de resumen y descarga autorizada por archivo.

Cada comando tiene un identificador y una huella, y cada ticket tiene versión. Los reintentos no duplican operaciones; una versión antigua recibe conflicto. PostgreSQL bloquea la secuencia al crear y los casos afectados al gestionar; la fusión toma bloqueos en orden estable. SQLite serializa las transacciones. La fusión conserva los números como alias y redirige conversaciones, referencias de correo y envíos pendientes.

Los seguimientos previos de **Agentec** se incorporan de forma idempotente por `legacy_id`, conservando sus autores y fechas. La solicitud original se conserva en el servicio como origen durable y no vuelve a gestionarse desde `/api/followups` (responde 410). La gestión actual se consulta en Tickets. No hay conexión con la base de Zammad.

El esquema está en `supabase/migrations/20261022_tickets.sql`. La aplicación también realiza su creación idempotente antes del primer uso. Las tablas tienen RLS sin políticas públicas; sólo el backend accede con su conexión de base. No se aplicó esta migración a producción durante el desarrollo.

## Permisos y configuración

Administración → Configuración → Tickets permite administrar categorías, subcategorías, áreas e integrantes, eventos y prioridades Crítica/Alta/Media/Baja. Las subcategorías pueden heredar o sobrescribir reglas. La clasificación conserva la versión de regla usada; una modificación del catálogo no reclasifica casos anteriores. Se desactivan opciones en lugar de borrar su historia.

`tickets.view` permite ver casos propios o donde se participó. Los permisos `tickets.scope.assigned`, `.area` y `.all` amplían el alcance. Asignación, clasificación, resolución, reapertura, fusión, respuesta por correo y vinculación de servicios tienen permisos separados. `tickets.internal` habilita notas internas; responder por correo requiere además consultar contactos. La búsqueda de cuentas respeta el alcance de clientes.

Los permisos previos de Seguimientos se conservan como compatibilidad y se traducen si no existe una selección explícita de Tickets. Antes de habilitar el módulo a cada equipo, revisar los permisos y miembros de áreas: poder crear un ticket propio no concede lectura de todos los casos de otras personas. Administrador tiene acceso completo.

Para que dos operadores detecten los reclamos cargados por sus compañeros, habilitar en su rol consulta, creación, observaciones y alcance de área; incorporarlos al área responsable de esas categorías en Configuración de Tickets. El aviso de coincidencias respeta ese alcance. Los roles granulares existentes requieren habilitar explícitamente las nuevas capacidades. La lectura de notas internas y la gestión administrativa se conceden por separado.

## Correo: formulario de entrada y salida

Administración → Configuración → Tickets → Correo de soporte permite configurar un canal de correo desde Agentec. La cuenta inicia desactivada. El acceso al formulario y a sus operaciones exige el permiso de configuración de Tickets; una persona autorizada a responder casos no obtiene por ello acceso a las credenciales del canal.

El formulario separa **Correo entrante** de **Correo saliente** siguiendo la organización de la [configuración de cuentas de Zammad](https://admin-docs.zammad.org/en/latest/channels/email/accounts/account-setup.html). En Agentec se utiliza un único buzón de soporte, con área de destino, dirección y nombre de remitente; no se implementan POP3, Sendmail, archivo histórico ni múltiples cuentas.

| Sección | Datos y comportamiento |
| --- | --- |
| Identidad y destino | Dirección de soporte, nombre mostrado al responder y área responsable de los nuevos tickets recibidos. |
| Correo entrante | IMAP: servidor, puerto, SSL/TLS o STARTTLS, usuario, contraseña y carpeta. La carpeta predeterminada es `INBOX`. Se verifica el certificado. |
| Correo saliente | SMTP: servidor, puerto, SSL/TLS o STARTTLS, usuario y contraseña; admite reutilizar las credenciales de entrada mediante una opción explícita. |
| Contraseñas | Una contraseña vacía conserva la ya guardada. El formulario indica si existe una credencial, sin volver a mostrarla. Para reemplazarla se ingresa el nuevo valor. |
| Conservación | Los mensajes se conservan siempre: IMAP se abre en sólo lectura, sin borrar, mover ni marcar como leído. |
| Operación | Guardar, probar conexión, activar en prueba u operativo, pausar y procesar una ejecución manual. El estado muestra ejecuciones y errores de forma resumida. |

Para **GoDaddy Professional Email**, la configuración oficial es `imap.secureserver.net`, puerto `993`, SSL/TLS, y `smtpout.secureserver.net`, puerto `465`, SSL/TLS; el usuario suele ser la dirección completa. Verificar el producto contratado: estas instrucciones no configuran una cuenta Microsoft 365. [Configuración oficial de GoDaddy](https://www.godaddy.com/en-ph/help/use-imap-settings-to-add-my-professional-email-to-a-client-32204).

Guardar datos deja el canal pausado e invalida las pruebas anteriores. Se verifica la misma revisión guardada antes de permitir la activación; las dos pruebas deben haber resultado correctas durante las últimas 24 horas. Probar entrada autentica y abre la carpeta en sólo lectura; probar salida usa `SMTP.verify`, **sin enviar un mensaje**. Esta última prueba no acredita entrega, aceptación de un remitente específico ni recepción por el cliente. Ese alcance coincide con lo documentado para [verificación de Nodemailer](https://nodemailer.com/smtp#verifying-the-configuration).

Zammad también ofrece conservar mensajes, pero esa opción marca los importados como leídos; su verificación de cuenta envía correos de prueba. Agentec mantiene la lectura por UID sin modificar flags y no envía correos durante la prueba de conexión. La distinción permite conservar la convivencia acordada con Zammad. [Conservación y verificación en Zammad](https://admin-docs.zammad.org/en/latest/channels/email/accounts/account-setup.html#keep-messages-on-server).

### Protección y persistencia de las credenciales

Las contraseñas se reciben mediante HTTPS y se cifran en el servidor antes de persistir. No se incluyen en las respuestas de consulta, en la configuración general de la aplicación, en el almacenamiento del navegador ni en los registros de diagnóstico. Las credenciales de IMAP y SMTP son independientes cuando no se selecciona reutilizar las de entrada.

Cambiar el servidor, usuario o dirección de correo exige volver a ingresar la contraseña correspondiente. La conexión admite servidores públicos con certificados válidos y los puertos estándar de IMAP/SMTP; no permite utilizar el formulario para conectarse a servicios de la red privada.

El cifrado usa una clave derivada de `PIGNUS_SESSION_SECRET` mediante HKDF, con contexto propio del canal. Puede utilizarse una clave dedicada mediante `TICKETS_MAIL_ENCRYPTION_KEY`, de al menos 32 caracteres aleatorios. Debe existir la misma clave en la API y en cualquier worker externo que lea la base. La clave se mantiene en secretos del servidor, separada de la base de datos y de sus respaldos.

Cambiar la clave de cifrado —incluido cambiar la clave de sesión cuando se usa como origen— puede impedir leer credenciales existentes. La rotación debe planificarse: pausar el canal, conservar la clave anterior para recuperación, definir la nueva clave en todos los procesos, volver a cargar las contraseñas, probar y activar nuevamente. No existe una recuperación de contraseñas desde la interfaz. No copiar secretos a tickets, commits ni mensajes de soporte.

La configuración guardada en Agentec prevalece sobre la configuración histórica `TICKETS_MAIL_*` del entorno. Esas variables se conservan como compatibilidad para instalaciones anteriores; una vez guardado el canal, no son una segunda fuente para modificarlo. El estado activo o pausado también se conserva en la base.

### Prueba inicial y convivencia con Zammad

1. Preparar un **buzón o carpeta aislada de prueba** que reciba copias. Puede usarse `INBOX` de una cuenta exclusiva para pruebas; no usar el buzón operativo completo como fuente de prueba. Agentec no elimina mensajes, pero no puede impedir que otro sistema los elimine del buzón compartido.
2. Cargar los datos en Correo de soporte, seleccionar la carpeta de prueba, guardar y probar entrada y salida. Confirmar que se trata de una fuente aislada antes de activar el modo Prueba.
3. Activar y ejecutar el procesamiento manual. La **primera ejecución guarda UIDNEXT como punto de partida y omite todo el correo anterior**. Enviar los mensajes de prueba después de ese punto. Una conexión verificada por sí sola no inicia la recepción.
4. Comprobar creación del ticket, clasificación en el área elegida, vinculación manual de cuentas, adjuntos, duplicados y errores. El modo Prueba no envía respuestas; los tickets creados como prueba tampoco pueden responder al cliente al cambiar luego a Operativo.
5. Configurar y probar el programador periódico si se requiere recepción automática. El botón de procesamiento manual ejecuta un ciclo acotado y no crea una tarea periódica.
6. Para pasar al buzón operativo, guardar la configuración final, repetir las pruebas y activar Operativo. El cambio de modo o identidad de buzón tiene su propio punto de activación; no recupera historia anterior. Coordinar qué sistema responde mientras Zammad continúa en paralelo.

Una pausa conserva el cursor. Al reanudar la misma fuente y modo se continúa desde ese punto; no equivale a recrear un canal. Una carpeta o cuenta diferente necesita revisar el nuevo punto de activación. No cambiar de buzón con respuestas pendientes sin revisar primero la cola: los envíos conservan su vínculo con el canal de origen.

### Ejecución automática y diagnóstico

Hay tres formas de ejecutar el mismo procesamiento: desde el formulario con una sesión autorizada; mediante `npm run mail:tickets` en un proceso con acceso a PostgreSQL y a IMAP/SMTP; o mediante un programador externo que llame al endpoint protegido:

```http
POST /api/tickets/mail/process
Authorization: Bearer <TICKETS_MAIL_WORKER_SECRET>
Content-Type: application/json

{}
```

`TICKETS_MAIL_WORKER_SECRET` es un secreto aleatorio de al menos 32 caracteres, diferente de la contraseña del buzón. Debe configurarse tanto en el servidor como en el almacén secreto del programador. No colocarlo en la URL, el repositorio, capturas ni logs. Sin un secreto válido, el endpoint no permite ejecuciones anónimas. El programador debe usar HTTPS, conservar el resultado de cada ejecución y alertar ante errores persistentes. La frecuencia y el servicio de ejecución se eligen según el volumen y el tiempo de atención esperado; no se contrata infraestructura al guardar el formulario.

El CLI resuelve la configuración desde la misma base que la API. `npm run mail:tickets -- --status` consulta el estado sin descargar ni enviar mensajes. Se necesitan `DATABASE_URL` y la clave de cifrado correspondiente en el entorno del proceso. Los límites `TICKETS_MAIL_BATCH_SIZE` y `TICKETS_MAIL_MAX_RUN_MS` acotan el lote; las reservas de buzón impiden superposición entre las distintas formas de ejecución.

No se agrega automáticamente un cron en Vercel. La documentación de Vercel limita Hobby a una ejecución diaria y rechaza durante el despliegue frecuencias mayores; por eso no se presupone suficiente para una bandeja de soporte. Un scheduler externo o un plan compatible debe configurarse expresamente. [Límites oficiales de Vercel Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing).

La pantalla muestra última ejecución correcta, error y estados de la cola. Un cambio de UIDVALIDITY requiere revisar el punto de activación: no se reinicia automáticamente ni importa mensajes históricos. Las pruebas de conexión no sustituyen la supervisión de las ejecuciones periódicas ni del espacio disponible en el buzón.

La recepción deduplica por Message-ID (o huella del contenido cuando falta). Las respuestas se vinculan por encabezados y por `Ticket#`, comprobando que el remitente ya participa en el caso. Conocer un número no permite agregar mensajes a un caso ajeno. Una dirección no identificada abre un caso para clasificación y vinculación manual, sin inventar una cuenta.

Se ignoran bucles, rebotes y respuestas automáticas. HTML se convierte a texto, sin cargar recursos remotos. Un mensaje demasiado grande, ilegible o con archivos no admitidos genera un caso **Correo que requiere revisión** con referencia al original; se conserva en el buzón y los mensajes siguientes continúan. Los textos extensos indican que se muestran parcialmente.

Adjuntos: hasta cinco PDF/JPEG/PNG/WEBP por mensaje, 2 MB por archivo y 2,5 MB total; firma y tamaño se comprueban en el servidor. Los límites mantienen la carga HTTP dentro del límite de la plataforma de despliegue. La descarga verifica el ticket y la visibilidad de la nota, y fuerza descarga sin ejecutar contenido.

Las respuestas salen de una cola transaccional. `queued`, `retry`, `sending`, `sent`, `failed` y `uncertain` distinguen recepción por SMTP de errores. Un timeout después de transmitir el cuerpo puede haber entregado: queda `uncertain` y **no se reenvía automáticamente**. Revisar el buzón antes de registrar otra respuesta. La aceptación SMTP no garantiza lectura o entrega final al destinatario. No se envían acuses automáticos.

## Comprobación antes de habilitar el equipo

- Crear una solicitud interna sin cuenta y un reclamo con cuenta; comprobar categorías, prioridad heredada y alcance de lectura.
- Sobre una cuenta con un caso abierto, revisar el caso y aportar información: debe conservarse el número y agregarse autor, fecha y canal. Crear un caso distinto exige decisión explícita.
- Probar la concurrencia con dos usuarios que abren el formulario antes de guardar: el segundo debe revisar las coincidencias actualizadas, sin perder el texto que escribió.
- Asignar un responsable, registrar espera y revisión, resolver con resultado y reabrir con motivo. La conversación y las referencias deben conservarse.
- Verificar que una fusión conserva ambos números como referencias y que los adjuntos de notas internas sólo son descargables por roles autorizados.
- Enviar correos únicamente al buzón aislado de prueba después de activar el worker. Confirmar que el mensaje aparece como prueba y que no se puede responder por SMTP desde ese caso.

## Verificación y operación pendiente

Pruebas de dominio, SQLite, PostgreSQL con PGlite y correo con adaptadores simulados: `node --test tests/tickets-store.test.cjs tests/ticket-mail.test.cjs tests/ticket-mail-channel.test.cjs tests/ticket-mail-service.test.cjs`. La integración HTTP se verifica en `tests/security.integration.test.cjs`. Los datos usados en verificación visual son ficticios.

Validación del 22/10/2026: compilación de producción aprobada; 32 pruebas del almacenamiento de Tickets y 18 de correo aprobadas; 43 comprobaciones de interfaz, permisos y compatibilidad aprobadas; 11 controles UX aprobados. La prueba en navegador cubrió alta, revisión y aporte a un duplicado, asignación, prioridad, resolución, reapertura y guardado de configuración, además de escritorio, móvil y tema oscuro.

La suite general no queda completamente verde: conserva cinco fallos reproducidos también sobre `HEAD 6d6c5af`, anteriores a Tickets (descripción de botón en horarios mensuales, historial de configuración, selector de equipos mensuales y dos pruebas de controles vehiculares). La aserción de compatibilidad que aún esperaba el texto «Seguimientos» se actualizó a «Tickets» y sus cuatro pruebas volvieron a pasar. Estos fallos anteriores no se ocultan ni se modifican como parte del módulo.

La conexión real a GoDaddy se configura desde el formulario; la clave de cifrado y el secreto del programador permanecen en el entorno del servidor. El scheduler y la habilitación operativa deben configurarse expresamente. Las verificaciones automatizadas usan adaptadores de correo simulados: no acreditan credenciales reales ni entregabilidad. No se hicieron envíos reales ni cambios en Zammad como parte de este ajuste. La publicación requiere el despliegue normal del proyecto y revisión de permisos de los roles que participarán.

Validación del formulario de correo (22/10/2026): 84 pruebas de Tickets, correo, canal y proceso aprobadas; 2 pruebas HTTP de Tickets aprobadas (incluyen permisos, credenciales y autenticación del proceso); 11 controles UX aprobados. Revisión visual con API simulada en escritorio, móvil de 390 px y tema oscuro, sin desbordamientos ni errores React. Las pruebas de conexión usaron adaptadores ficticios, sin acceder a GoDaddy.
