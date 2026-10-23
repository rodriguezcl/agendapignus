# Tickets de Agentec

Implementación: 22/10/2026. Reemplaza la bandeja visible de Seguimientos. No importa datos, conversaciones ni números de Zammad.

## Uso y reglas

- Un caso recibe un número inmutable `Ticket#1000001`. La secuencia inicial es configurable antes de emitir el primer número; mínimo cinco dígitos, sin reinicio al cambiar de año. No se afirma que el rango no coincida con Zammad: son sistemas independientes.
- Reclamo telefónico: cuenta obligatoria, categoría/subcategoría, evento y zona cuando corresponden, observación y adjuntos. Una solicitud interna admite cuenta opcional según la categoría.
- El formulario genera un asunto de sólo lectura en mayúsculas con cuenta, evento y categoría/subcategoría; omite el evento si no corresponde y usa el solicitante o SOLICITUD INTERNA cuando no hay cuenta. El servidor lo reconstruye con los datos autorizados al crear. Los asuntos de correo, integraciones anteriores y tickets existentes conservan su comportamiento. La fecha/hora del evento comienza con el momento local de apertura del formulario y puede corregirse. Observaciones es obligatorio y lleva asterisco rojo.
- Cancelar, Escape o pulsar fuera del formulario de alta abre una confirmación visible por encima del modal, incluso si está vacío. Enter confirma el descarte y Escape vuelve al borrador. En los modales, Enter ejecuta la acción principal única habilitada; respeta validaciones y bloqueos. En observaciones conserva saltos de línea y en selectores conserva el manejo nativo. Ningún atajo actúa sobre el formulario que queda detrás de una confirmación.
- Durante la creación, una cuenta autorizada muestra sus casos abiertos aunque no pertenezcan a la bandeja habitual del usuario. La vista de coincidencias permite revisar la conversación pública, sin notas internas, adjuntos ni acciones de gestión. Se puede sumar información al mismo caso o confirmar que es distinto. La creación vuelve a comprobar coincidencias y exige una confirmación vigente. No se fusiona sólo por compartir una cuenta.
- Las observaciones conservan autor, fecha, canal, visibilidad y adjuntos. Agregar información no envía un correo. Las notas internas requieren permiso adicional y nunca se incluyen automáticamente en una respuesta.
- Estados: Nuevo, En gestión, En espera, Resuelto y Fusionado. Resolver y cerrar requiere informar el resultado y seleccionar el medio en la interfaz. Si el ticket no tiene responsable, se asigna automáticamente a quien confirma el cierre; si ya tiene uno, se conserva esa asignación. El estado guardado continúa siendo Resuelto. Reabrir exige motivo. La espera admite fecha de revisión. Abrir una notificación no resuelve el caso.
- Una fusión requiere permiso y confirmación, y conserva las referencias originales, autores, archivos y vínculos. El principal mantiene su número. Fusionado es un archivo de referencia, no otro caso activo.
- Vincular servicios existentes requiere acceso al servicio y coincidencia de la cuenta. **Agendar servicio** abre la planificación con la cuenta y el reclamo precargados, permite elegir fecha, equipo y disponibilidad, y conserva el vínculo aunque se edite el detalle.
- En el informe técnico, Solicitar acción / seguimiento guarda la solicitud junto con el resultado del servicio. Si se identifica un caso abierto, se incorpora el aporte conservando su autor. Si aparecen nuevas coincidencias o el caso elegido cambia, deja de ser accesible o se cierra, se pide revisar conservando el borrador; no se crea otro ticket silenciosamente. Nueva solicitud en la ficha permite registrar otro caso del mismo servicio.

## Resolución remota

Un ticket no necesita un servicio vinculado para poder resolverse. Después de atender el caso, soporte elige **Resolver y cerrar**, informa el **Medio de resolución** —Llamada, Chat, Correo, Visita técnica u Otra gestión— y describe el resultado verificado. El autor, el medio y el resultado quedan en la cronología. Elegir un medio documenta una atención ya realizada; no inicia comunicaciones por ese canal.

Cerrar remotamente no cancela visitas previamente programadas. La ficha advierte si quedan servicios pendientes para que soporte revise la agenda. La reapertura elimina el medio del cierre vigente y conserva el evento histórico. El cierre automático mediante un informe técnico registra **Visita técnica**. Por compatibilidad, las integraciones anteriores pueden omitir `resolutionMethod`; el servidor no inventa un medio, pero rechaza valores explícitos desconocidos.

Una llamada o un chat registrados al resolver cuentan como respuesta humana para el SLA, incluso si el ticket ingresó por correo. Las respuestas SMTP conservan su confirmación por entrega; elegir Correo como medio no equivale a enviar un mensaje desde Agentec.

## Del reclamo a la visita y su resultado

Desde la ficha del ticket, **Agendar servicio** requiere permisos para vincular servicios y crear planificación, además del acceso a la cuenta. El ticket debe estar abierto y tener un abonado o cliente vinculado. Se elige una fecha, un equipo y una franja disponible; luego se completa el formulario habitual de Agenda con tipo de servicio, duración y datos operativos. Se aplican los controles de horarios, técnicos compartidos, feriados y concurrencia de la agenda.

La categoría o subcategoría puede definir un **Servicio sugerido para visitas**. Si sigue activo, se precargan su tipo y duración del catálogo, ambos editables antes de guardar. Por ejemplo, Cámaras / CCTV puede proponer Service de cámaras. Si falta la asociación o el servicio ya no está disponible, se elige manualmente. No se interpreta el texto del reclamo para adivinar un servicio y abrir la coordinación no crea ninguna visita.

La cuenta se toma de sus datos vigentes, no de una copia antigua en la conversación. El detalle incluye `Ticket#número`; la relación se guarda además mediante `sourceTicketId` y `ticketNumber` en el servicio y sus proyecciones. El servicio y su asociación se confirman en la misma operación de persistencia. Las jornadas adicionales conservan el vínculo. Editar las observaciones no elimina la asociación.

La programación, los cambios de fecha y las cancelaciones dejan trazabilidad en el caso y generan avisos para su creador. Programar una visita mantiene el ticket en gestión. Cancelar o eliminar una planificación no equivale a resolver el reclamo: el caso debe seguir siendo revisado por soporte.

En el informe final, el técnico debe marcar explícitamente **El reclamo asociado quedó resuelto** y detallar el resultado. Esa casilla comienza desmarcada. Un avance de jornada no ofrece confirmación de cierre. El servidor sólo resuelve automáticamente el ticket cuando se acredita la resolución y no quedan visitas, jornadas o acciones pendientes del mismo caso. Si no se marca la casilla, el informe se conserva y el ticket sigue abierto para revisión.

**Solicitar acción / seguimiento** distingue dos situaciones: si el pedido corresponde al mismo reclamo, se suma al caso y evita su cierre automático; si es un pedido diferente —por ejemplo, cotizar una cámara adicional después de reparar la avería— se identifica expresamente como **Es un caso diferente**. El nuevo pedido conserva su propio seguimiento y no se confunde con la resolución del reclamo original.

Los avisos de avances y resolución permanecen en la campana aunque el ticket ya esté resuelto, hasta que el destinatario abre el caso y se marcan como leídos. La conversación conserva su registro. Leer un aviso no cambia el estado del caso. El cierre automático conserva el informe técnico y la identidad de quien informó el resultado como evidencia.

Los títulos de la campana priorizan el código y el nombre de la cuenta, seguidos por `Ticket#` y el estado o la novedad. Se usan los datos vigentes de la cuenta, con respaldo en la ficha del ticket si la cuenta ya no está disponible. Sin cuenta, se muestra el solicitante (el remitente para correo), luego quien creó el caso; si no hay un nombre identificable se indica Solicitud por correo o Solicitud sin cuenta. No se incluyen direcciones de correo en estos títulos. Este formato también se aplica al consultar avisos anteriores, sin modificar su lectura, destinatarios o historial.

## Objetivos de atención y resolución (SLA)

En **Administración → Configuración → Tickets** se definen los plazos por prioridad. Son objetivos operativos editables; los valores iniciales son:

| Prioridad | Primera respuesta | Resolución efectiva | Actualización del caso |
| --- | --- | --- | --- |
| Crítica | 15 minutos | 4 horas | 1 hora |
| Alta | 1 hora | 24 horas | 4 horas |
| Media | 4 horas | 72 horas | 24 horas |
| Baja | 8 horas | 120 horas | 48 horas |

El reloj usa **horas corridas**, incluidos fines de semana y feriados. Pasar a **En espera** no pausa ni reinicia el plazo de resolución; la fecha de revisión sirve para organizar la próxima gestión. Agendar una visita tampoco equivale a resolver el caso. El acuse automático confirma recepción, pero no reemplaza una primera respuesta humana.

Para casos por correo, una respuesta o un aviso derivado de una gestión humana cuenta cuando SMTP confirma su aceptación. Estar en cola, fallar o quedar con entrega incierta no cumple ese objetivo; tampoco lo cumple un comentario que sólo quedó dentro de Agentec. Los reintentos y las respuestas encoladas antes de una reapertura no renuevan el ciclo actual. La aceptación SMTP no acredita lectura por parte del destinatario.

Cada ticket conserva una copia de los objetivos vigentes al comenzar su seguimiento SLA. Editar la configuración aplica a casos nuevos y no altera silenciosamente los plazos históricos. Si cambia la prioridad de un ticket, se usa la tabla de objetivos guardada en ese caso, sin otorgar un nuevo plazo completo desde la reclasificación. Los tickets existentes sin SLA comienzan a medirse al incorporarse al nuevo esquema; no se les atribuyen incumplimientos retroactivos anteriores a esa incorporación.

La ficha y la bandeja permiten identificar objetivos y vencimientos. Si un caso queda sin novedades, se recuerda al responsable que debe revisarlo y comunicar un avance concreto; no se envían mensajes repetitivos al cliente que simulen actividad. La ejecución periódica comprueba los plazos y evita duplicar recordatorios del mismo hito.

## Comunicación automática

Los mensajes reconocen el reporte, agradecen la información y explican el estado real: recibido, visita programada, cambio de planificación o resolución confirmada. Se conserva un tono humano y respetuoso, sin afirmar que el equipo ya comenzó a trabajar cuando todavía no ocurrió ni prometer una fecha no coordinada.

Los avisos de avance dentro de Agentec se dirigen al creador y al solicitante autorizado; quien realizó la acción no recibe un aviso duplicado de su propia gestión. Los recordatorios SLA se dirigen al responsable asignado o al área y sus administradores cuando falta asignación. El correo automático se utiliza sólo para casos de origen correo, recibidos en modo operativo y asociados a la misma cuenta de soporte activa. No envía mensajes desde casos de prueba ni convierte notas internas en respuestas al cliente. Los envíos pasan por la cola existente, con trazabilidad e idempotencia. Las respuestas automáticas pueden incorporar la firma común del buzón bajo las mismas reglas de contenido y reintento que las respuestas manuales.

## Persistencia y concurrencia

`api/_lib/tickets.cjs` contiene las reglas; `tickets-store.cjs`, las transacciones; `tickets-http.cjs`, el transporte compartido por PostgreSQL y SQLite. `src/features/tickets` contiene la bandeja, los formularios y la administración.

Las tablas `pignus_ticket_*` están separadas del documento de estado de Agenda. No se sobrescriben al guardar roles, servicios o clientes. Las conversaciones y archivos no viajan en el listado: hay paginación SQL, DTO de resumen y descarga autorizada por archivo.

Cada comando tiene un identificador y una huella, y cada ticket tiene versión. Los reintentos no duplican operaciones; una versión antigua recibe conflicto. PostgreSQL bloquea la secuencia al crear y los casos afectados al gestionar; la fusión toma bloqueos en orden estable. SQLite serializa las transacciones. La fusión conserva los números como alias y redirige conversaciones, referencias de correo y envíos pendientes.

Los seguimientos previos de **Agentec** se incorporan de forma idempotente por `legacy_id`, conservando sus autores y fechas. La solicitud original se conserva en el servicio como origen durable y no vuelve a gestionarse desde `/api/followups` (responde 410). La gestión actual se consulta en Tickets. No hay conexión con la base de Zammad.

El esquema base está en `supabase/migrations/20261022_tickets.sql` y los avisos persistentes se incorporan con `20261022_tickets_notifications.sql`. La aplicación también realiza su creación idempotente antes del primer uso. Los objetivos SLA y las asociaciones con servicios se guardan en el documento de cada ticket. Las tablas tienen RLS sin políticas públicas; sólo el backend accede con su conexión de base. No se aplicaron migraciones a producción durante este ajuste.

## Permisos y configuración

Administración → Configuración → Tickets permite administrar categorías, subcategorías, áreas e integrantes, eventos, prioridades Crítica/Alta/Media/Baja y objetivos SLA. Las subcategorías pueden heredar o sobrescribir reglas. La clasificación conserva la versión de regla usada; una modificación del catálogo no reclasifica casos anteriores. Se desactivan opciones en lugar de borrar su historia.

El catálogo inicial contempla Alarmas, Cámaras / CCTV, Cerco eléctrico y Tótems, además de trabajos realizados, solicitudes comerciales, soporte interno y otras solicitudes. Las familias técnicas clasifican el problema; no obligan a generar una visita. `defaultServiceId` relaciona una categoría con un servicio activo del catálogo. En una subcategoría, su ausencia hereda la categoría y `''` significa Sin servicio sugerido. Los controles vehiculares y las actividades internas no se ofrecen como sugerencias.

La inicialización `ticket-service-defaults-v1` se aplica una sola vez bajo bloqueo de configuración cuando está disponible el catálogo de servicios. Agrega familias faltantes sin duplicar equivalentes ni reemplazar categorías personalizadas. Sólo asocia automáticamente un mantenimiento si encuentra una coincidencia única por código estable o nombre exacto; no elige instalaciones por aproximación. Incrementa la versión si modifica la configuración y conserva intactos los tickets históricos. `suggestedServiceId` se calcula al consultar el detalle con las reglas actuales, sin persistirlo como dato histórico del ticket.

`tickets.view` permite consultar los casos autorizados según el rol. Los técnicos mantienen un alcance personal: solicitudes propias o compartidas explícitamente, casos asignados y reclamos vinculados expresamente a sus servicios. Compartir equipo o cuenta no habilita una bandeja ajena. Para los demás roles, `tickets.scope.assigned`, `.area` y `.all` amplían el alcance. Asignación, clasificación, resolución, reapertura, fusión, respuesta por correo y vinculación de servicios tienen permisos separados. `tickets.internal` habilita notas internas; responder por correo requiere además consultar contactos. La búsqueda de cuentas respeta el alcance de clientes.

Los permisos previos de Seguimientos se conservan como compatibilidad y se traducen si no existe una selección explícita de Tickets. Antes de habilitar el módulo a cada equipo, revisar los permisos y miembros de áreas: poder crear un ticket propio no concede lectura de todos los casos de otras personas. Administrador tiene acceso completo.

La excepción de coincidencias permite detectar duplicados de una cuenta autorizada al crear o informar seguimiento, sin conceder acceso general al resto de los tickets. Incorporar un aporte al mismo caso registra al solicitante para su seguimiento. Para gestionar la bandeja del área se necesitan sus permisos y pertenencia correspondientes. Los roles granulares existentes requieren habilitar explícitamente las nuevas capacidades. La lectura de notas internas y la gestión administrativa se conceden por separado.

## Correo: formulario de entrada y salida

Administración → Configuración → Correo de soporte permite configurar un canal de correo desde Agentec. La cuenta inicia desactivada. El acceso al formulario y a sus operaciones exige el permiso de configuración de Tickets; una persona autorizada a responder casos no obtiene por ello acceso a las credenciales del canal.

El formulario separa **Correo entrante** de **Correo saliente** siguiendo la organización de la [configuración de cuentas de Zammad](https://admin-docs.zammad.org/en/latest/channels/email/accounts/account-setup.html). En Agentec se utiliza un único buzón de soporte, con área de destino, dirección y nombre de remitente; no se implementan POP3, Sendmail, archivo histórico ni múltiples cuentas.

| Sección | Datos y comportamiento |
| --- | --- |
| Identidad y destino | Dirección de soporte, nombre mostrado al responder y área responsable de los nuevos tickets recibidos. |
| Correo entrante | IMAP: servidor, puerto, SSL/TLS o STARTTLS, usuario, contraseña y carpeta. La carpeta predeterminada es `INBOX`. Se verifica el certificado. |
| Correo saliente | SMTP: servidor, puerto, SSL/TLS o STARTTLS, usuario y contraseña; admite reutilizar las credenciales de entrada mediante una opción explícita. |
| Contraseñas | Una contraseña vacía conserva la ya guardada. El formulario indica si existe una credencial, sin volver a mostrarla. Para reemplazarla se ingresa el nuevo valor. |
| Conservación | Los mensajes se conservan siempre: IMAP se abre en sólo lectura, sin borrar, mover ni marcar como leído. |
| Operación | Guardar, probar conexión, activar en prueba u operativo, pausar y procesar una ejecución manual. El estado distingue la programación automática del canal y muestra los últimos intentos, resultados y errores. |

Para **GoDaddy Professional Email**, la configuración oficial es `imap.secureserver.net`, puerto `993`, SSL/TLS, y `smtpout.secureserver.net`, puerto `465`, SSL/TLS; el usuario suele ser la dirección completa. Verificar el producto contratado: estas instrucciones no configuran una cuenta Microsoft 365. [Configuración oficial de GoDaddy](https://www.godaddy.com/en-ph/help/use-imap-settings-to-add-my-professional-email-to-a-client-32204).

Guardar los datos de conexión deja el canal pausado e invalida las pruebas anteriores. Se verifica la misma revisión guardada antes de permitir la activación; las dos pruebas deben haber resultado correctas durante las últimas 24 horas. Probar entrada autentica y abre la carpeta en sólo lectura; probar salida usa `SMTP.verify`, **sin enviar un mensaje**. Esta última prueba no acredita entrega, aceptación de un remitente específico ni recepción por el cliente. Ese alcance coincide con lo documentado para [verificación de Nodemailer](https://nodemailer.com/smtp#verifying-the-configuration).

Zammad también ofrece conservar mensajes, pero esa opción marca los importados como leídos; su verificación de cuenta envía correos de prueba. Agentec mantiene la lectura por UID sin modificar flags y no envía correos durante la prueba de conexión. La distinción permite conservar la convivencia acordada con Zammad. [Conservación y verificación en Zammad](https://admin-docs.zammad.org/en/latest/channels/email/accounts/account-setup.html#keep-messages-on-server).

### Firma común de soporte

En **Correo de soporte → Firma de las respuestas** se escribe o pega la firma compartida por todos los usuarios que responden desde el buzón. Puede copiarse el bloque visible de la firma de GoDaddy; la conexión IMAP/SMTP de Agentec no sincroniza esa configuración del webmail. El editor conserva formato compatible, tablas, enlaces y logos con URL HTTPS pública. No incorpora imágenes locales, `cid:` ni imágenes pegadas como datos; esas imágenes deben estar publicadas en HTTPS para incluirlas.

Activar **Agregar la firma a las respuestas por correo** y presionar **Guardar firma** aplica el cambio a las respuestas nuevas. Este guardado es independiente: no pausa el canal ni modifica credenciales o pruebas de conexión. Requiere el permiso de configuración de Tickets y una cuenta de correo ya guardada. El servidor valida la versión y el contenido, elimina HTML activo y deriva la alternativa de texto; límites: 50.000 caracteres de HTML y 8.000 de texto.

La respuesta queda firmada al registrarse en la cola. Los reintentos conservan ese contenido aunque luego cambie la firma; los mensajes ya encolados sin firma no se modifican. El historial conserva el texto firmado. Las notas internas no generan correos. Los avisos automáticos de resolución respetan las condiciones del apartado Comunicación automática y usan la firma del canal cuando está habilitada. El destinatario recibe versiones HTML y texto cuando la firma está habilitada; su cliente de correo puede bloquear imágenes remotas.

El paso `prebuild` empaqueta `sanitize-html` y sus dependencias como CommonJS en `api/_vendor/sanitize-html.cjs`. Vercel incluye ese archivo generado en la función: evita depender de `require(ESM)` en el runtime y conserva la versión actualizada del sanitizador. El archivo no se versiona; debe regenerarse con `npm run build` para cada publicación. La prueba de compatibilidad carga el servicio con `--no-experimental-require-module`.

**Guardar gestión** cierra la ficha únicamente cuando el servidor confirma el guardado y actualiza la bandeja. Si se solicitó responder, el aviso indica que el mensaje quedó en cola; su entrega se consulta en la conversación. Ante un error, la ficha conserva el contenido y los adjuntos para revisar o reintentar.

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
5. Consultar el estado de la ejecución automática en Funcionamiento. El programador configurado revisa el canal cada 2 minutos, aun sin sesiones abiertas; el botón de procesamiento manual ejecuta un único ciclo acotado y no cambia esa programación.
6. Para pasar al buzón operativo, guardar la configuración final, repetir las pruebas y activar Operativo. El cambio de modo o identidad de buzón tiene su propio punto de activación; no recupera historia anterior. Coordinar qué sistema responde mientras Zammad continúa en paralelo.

Una pausa conserva el cursor. Al reanudar la misma fuente y modo se continúa desde ese punto; no equivale a recrear un canal. Una carpeta o cuenta diferente necesita revisar el nuevo punto de activación. No cambiar de buzón con respuestas pendientes sin revisar primero la cola: los envíos conservan su vínculo con el canal de origen.

### Ejecución automática y diagnóstico

Hay tres formas de ejecutar el mismo procesamiento: desde el formulario con una sesión autorizada; mediante `npm run mail:tickets` en un proceso con acceso a PostgreSQL y a IMAP/SMTP; o mediante la programación de Supabase, que llama cada **2 minutos** al endpoint protegido de Vercel:

```http
POST /api/tickets/mail/process
Authorization: Bearer <credencial del proceso>
Content-Type: application/json

{}
```

La tarea `agentec-ticket-mail-every-2-minutes` usa **pg_cron** y **pg_net** de Supabase. Se ejecuta en el servidor y no depende de que una persona mantenga Agentec abierto. El trabajo guarda su credencial en Supabase Vault, bajo el nombre `agentec-ticket-mail-worker`; el comando de cron no contiene el secreto. [Supabase Cron](https://supabase.com/docs/guides/cron) y [solicitudes HTTP con pg_net](https://supabase.com/docs/guides/database/extensions/pg_net).

La configuración y la función de invocación viven en `agentec_private`, sin permisos para `PUBLIC`, `anon` o `authenticated`. Supabase administra las tablas internas de `net`; su cola contiene el encabezado de autorización mientras procesa cada solicitud. Mantener `net` y `agentec_private` fuera de los esquemas expuestos por la Data API y no publicar vistas ni funciones que permitan consultar esa cola. Los resultados de pg_net se conservan normalmente durante seis horas; el historial de cron puede consultarse para diagnosticar fallos anteriores al envío HTTP.

La credencial puede definirse con `TICKETS_MAIL_WORKER_SECRET`, de al menos 32 caracteres aleatorios, diferente de la contraseña del buzón. Si se omite la variable, la API y el aprovisionamiento la derivan de `PIGNUS_SESSION_SECRET` mediante HKDF con un contexto exclusivo para esta tarea. Un valor explícitamente vacío o de menos de 32 caracteres se rechaza; no activa la derivación. Ambos deben usar la misma configuración. No colocar el secreto ni su derivación en la URL, el repositorio, capturas ni logs; Vault conserva el valor necesario para autenticar la solicitud. Sin una credencial válida, el endpoint no permite ejecutar el correo.

La programación es independiente del canal: un ciclo con correo desactivado revisa los SLA sin conectarse a IMAP o SMTP. En modo Prueba no se envían mensajes; en Operativo se reciben los nuevos correos y se procesan las respuestas solicitadas desde Tickets y los avisos automáticos de recepción, coordinación y avance del caso. Programar o pausar la tarea no modifica las credenciales, el modo del canal ni Zammad.

#### Aprovisionamiento y mantenimiento

El script `scripts/configure-ticket-mail-schedule.cjs` se ejecuta con `DATABASE_URL` y la misma credencial o clave de origen que la API. El comando de estado es de sólo lectura; los demás requieren `--confirm` explícito:

```sh
npm run mail:tickets:schedule -- --status
npm run mail:tickets:schedule -- --prepare --confirm --url https://agenda.pignusarg.com
npm run mail:tickets:schedule -- --enable --confirm
npm run mail:tickets:schedule -- --disable --confirm
```

`--prepare` crea o actualiza la configuración y deja la tarea pausada. Luego de publicar una API compatible, `--enable` realiza una comprobación HTTPS autenticada mediante GET: el endpoint debe responder 405, porque sólo admite POST. Esta comprobación no recibe ni envía correo; después se habilita la tarea. `--disable` pausa la ejecución periódica y conserva la configuración. El estado permite revisar la programación y el último resultado sin exponer la credencial.

Si se rota `TICKETS_MAIL_WORKER_SECRET`, o `PIGNUS_SESSION_SECRET` cuando se usa la derivación, repetir `--prepare` y `--enable` con el nuevo valor y coordinar su actualización en Vercel. La tarea debe permanecer pausada hasta que coincidan las credenciales del servidor y Vault. Rotar la clave de sesión también puede afectar el cifrado del buzón: revisar la sección de protección de credenciales antes de cambiarla.

La solicitud de pg_net tiene un timeout de 65 segundos; la función de Vercel dispone de 60 segundos. El procesamiento tiene un presupuesto acotado por ciclo y una reserva global de 180 segundos que evita ejecuciones simultáneas, incluidas las manuales. Si ya existe un procesamiento, se devuelve 409 y la tarea vuelve a intentar en el siguiente ciclo; no crea un segundo procesamiento en paralelo.

El CLI resuelve la configuración desde la misma base que la API. `npm run mail:tickets -- --status` consulta el estado sin descargar ni enviar mensajes. Se necesitan `DATABASE_URL` y la clave de cifrado correspondiente en el entorno del proceso. Los límites `TICKETS_MAIL_BATCH_SIZE` y `TICKETS_MAIL_MAX_RUN_MS` acotan el lote; las reservas de buzón impiden superposición entre las distintas formas de ejecución.

No se configura un cron en Vercel: Supabase inicia las llamadas periódicas a la API existente. Esto evita depender de la frecuencia permitida por Vercel Cron en el plan contratado. Guardar el formulario de correo no crea ni modifica tareas de infraestructura. [Límites oficiales de Vercel Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing).

La pantalla muestra la última sincronización correcta, el estado activo/pausado de la programación, último intento y finalización, errores y estados de la cola. Un intento programado completado no significa que se hayan recibido mensajes: puede no haber novedades o el canal puede estar desactivado. Los errores y la ausencia de ejecuciones recientes se señalan al consultar el estado; no se envía una alerta externa de infraestructura. Un cambio de UIDVALIDITY requiere revisar el punto de activación: no se reinicia automáticamente ni importa mensajes históricos. Las pruebas de conexión no sustituyen la supervisión de las ejecuciones periódicas ni del espacio disponible en el buzón.

La recepción deduplica por Message-ID (o huella del contenido cuando falta). Las respuestas se vinculan por encabezados y por `Ticket#`, comprobando que el remitente ya participa en el caso. Conocer un número no permite agregar mensajes a un caso ajeno. Una dirección no identificada abre un caso para clasificación y vinculación manual, sin inventar una cuenta.

Se ignoran bucles, rebotes y respuestas automáticas. HTML se convierte a texto, sin cargar recursos remotos. Un mensaje demasiado grande, ilegible o con archivos no admitidos genera un caso **Correo que requiere revisión** con referencia al original; se conserva en el buzón y los mensajes siguientes continúan. Los textos extensos indican que se muestran parcialmente.

Adjuntos: hasta cinco PDF/JPEG/PNG/WEBP por mensaje, 2 MB por archivo y 2,5 MB total; firma y tamaño se comprueban en el servidor. Los límites mantienen la carga HTTP dentro del límite de la plataforma de despliegue. La descarga verifica el ticket y la visibilidad de la nota, y fuerza descarga sin ejecutar contenido.

Las respuestas salen de una cola transaccional. `queued`, `retry`, `sending`, `sent`, `failed` y `uncertain` distinguen recepción por SMTP de errores. Un timeout después de transmitir el cuerpo puede haber entregado: queda `uncertain` y **no se reenvía automáticamente**. Revisar el buzón antes de registrar otra respuesta. La aceptación SMTP no garantiza lectura o entrega final al destinatario. Los acuses y avances automáticos usan esta misma cola y las restricciones descritas en Comunicación automática.

## Comprobación antes de habilitar el equipo

- Crear una solicitud interna sin cuenta y un reclamo con cuenta; comprobar categorías, prioridad heredada y alcance de lectura.
- Sobre una cuenta con un caso abierto, revisar el caso y aportar información: debe conservarse el número y agregarse autor, fecha y canal. Crear un caso distinto exige decisión explícita.
- Probar la concurrencia con dos usuarios que abren el formulario antes de guardar: el segundo debe revisar las coincidencias actualizadas, sin perder el texto que escribió.
- Registrar espera y revisión; resolver por llamada o chat sin servicios vinculados, con medio y resultado, tanto un caso sin responsable como uno ya asignado. El primero debe asignarse a quien cierra y el segundo conservar su responsable. Reabrir con motivo debe conservar la conversación y las referencias.
- Verificar que una fusión conserva ambos números como referencias y que los adjuntos de notas internas sólo son descargables por roles autorizados.
- Enviar correos únicamente al buzón aislado de prueba después de activar el worker. Confirmar que el mensaje aparece como prueba y que no se puede responder por SMTP desde ese caso.
- Agendar desde un ticket, modificar el detalle y dividir en jornadas: comprobar que se conserva la referencia, que llegan los avisos al creador y que el caso no se cierra ante un avance parcial.
- Comprobar la sugerencia por categoría, herencia y exclusión explícita por subcategoría; verificar que se precarguen tipo y duración, que puedan editarse y que cancelar no cree una visita. Retirar el servicio del catálogo debe impedir que siga apareciendo como sugerencia.
- Completar sin confirmar resolución, con un seguimiento del mismo caso y con un pedido diferente: sólo el último escenario puede cerrar el reclamo original si se confirmó la resolución y no quedan otras acciones pendientes.
- Revisar los SLA, reclasificar la prioridad y pasar a espera: los objetivos deben conservar su origen temporal; cambiar la configuración no debe reiniciar casos existentes. Los recordatorios no deben duplicarse en cada ejecución.

## Verificación y operación pendiente

Validación del 23/10/2026 para atención remota y servicios sugeridos: pruebas de cierre sin visitas, medio e historial, reapertura, SLA, inicialización de categorías, configuración y herencia en SQLite/PostgreSQL aprobadas. La regresión de permisos y duplicados también pasó. La prueba de navegador con datos simulados verificó preselección, edición, vínculo al ticket, cancelación sin guardado y configuración en escritorio y móvil. Compilación de producción, 21 controles UX y sus 11 pruebas aprobados. Esta verificación no modificó datos de producción ni envió correos.

Validación de Agenda, comunicación y SLA (22/10/2026): el circuito transaccional pasó 37 pruebas en SQLite y PostgreSQL, incluidas visitas múltiples, vínculos anteriores, fusiones, reapertura y cierre técnico. Se verificaron por separado permisos, alias, concurrencia de escrituras, integración HTTP, acuses, entrega SMTP simulada y plazos. La compilación de producción y los controles UX pasaron. La revisión visual cubrió escritorio y móvil con datos ficticios. No se enviaron correos reales ni se publicaron estos cambios durante su desarrollo.

Pruebas de dominio, SQLite, PostgreSQL con PGlite y correo con adaptadores simulados: `node --test tests/tickets-store.test.cjs tests/ticket-mail.test.cjs tests/ticket-mail-channel.test.cjs tests/ticket-mail-service.test.cjs`. La integración HTTP se verifica en `tests/security.integration.test.cjs`. Los datos usados en verificación visual son ficticios.

Validación del 22/10/2026: compilación de producción aprobada; 32 pruebas del almacenamiento de Tickets y 18 de correo aprobadas; 43 comprobaciones de interfaz, permisos y compatibilidad aprobadas; 11 controles UX aprobados. La prueba en navegador cubrió alta, revisión y aporte a un duplicado, asignación, prioridad, resolución, reapertura y guardado de configuración, además de escritorio, móvil y tema oscuro.

La suite general no queda completamente verde: conserva cinco fallos reproducidos también sobre `HEAD 6d6c5af`, anteriores a Tickets (descripción de botón en horarios mensuales, historial de configuración, selector de equipos mensuales y dos pruebas de controles vehiculares). La aserción de compatibilidad que aún esperaba el texto «Seguimientos» se actualizó a «Tickets» y sus cuatro pruebas volvieron a pasar. Estos fallos anteriores no se ocultan ni se modifican como parte del módulo.

La conexión real a GoDaddy se configura desde el formulario; la clave de cifrado permanece en el entorno del servidor y la credencial del programador se conserva en Vault. La habilitación operativa del canal se realiza expresamente desde el formulario. Las verificaciones automatizadas usan adaptadores de correo simulados: no acreditan credenciales reales ni entregabilidad. No se hicieron envíos reales ni cambios en Zammad como parte del desarrollo del formulario. La publicación requiere el despliegue normal del proyecto y revisión de permisos de los roles que participarán.

Validación del formulario de correo (22/10/2026): 84 pruebas de Tickets, correo, canal y proceso aprobadas; 2 pruebas HTTP de Tickets aprobadas (incluyen permisos, credenciales y autenticación del proceso); 11 controles UX aprobados. Revisión visual con API simulada en escritorio, móvil de 390 px y tema oscuro, sin desbordamientos ni errores React. Las pruebas de conexión usaron adaptadores ficticios, sin acceder a GoDaddy.

Validación del programador (22/10/2026): autenticación dedicada, estado del cron, errores HTTP/SQL, ausencia de ejecuciones, concurrencia y provisión protegida por comprobación previa; pruebas de correo y canal aprobadas, 2 pruebas HTTP y 11 pruebas UX aprobadas, compilación de producción correcta. La preparación de Supabase se verificó con el trabajo pausado y sin modificar la versión del canal. La habilitación se realiza después del despliegue y debe verificarse con una ejecución programada real.
