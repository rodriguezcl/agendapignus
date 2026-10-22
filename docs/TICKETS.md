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

## Correo y convivencia con Zammad

La conexión queda **desactivada por defecto**. Las credenciales sólo se guardan en variables del servidor, nunca en el repositorio o navegador. Los hosts de GoDaddy utilizados son IMAP TLS 993 y SMTP TLS 465. Confirmar que el plan contratado utiliza estos servidores; una cuenta Microsoft 365 requiere su propia configuración.

1. Preparar una cuenta/carpeta de prueba que reciba copias, sin interferir con la recepción de Zammad. Agentec no cambia flags ni elimina mensajes, pero no puede impedir que otro sistema los elimine del buzón compartido.
2. Configurar las variables `TICKETS_MAIL_*` de `.env.example`. Para probar: `ENABLED=true`, `MODE=test`, `TEST_SOURCE_CONFIRMED=true` y datos de esa fuente aislada.
3. Ejecutar `npm run mail:tickets`. La **primera ejecución guarda UIDNEXT como punto de partida y omite todo el correo anterior**. Enviar los mensajes de prueba después de esa activación.
4. Programar el comando en un proceso con conexión PostgreSQL y salida IMAP/SMTP, con la frecuencia requerida. El proceso es acotado, usa una reserva del buzón para evitar ejecuciones superpuestas y guarda cursor/errores. No se añadió un cron a Vercel ni se contrató infraestructura automáticamente.
5. Verificar recepción, vinculación manual de cuentas, adjuntos, duplicados, respuestas y alertas. El modo `test` nunca crea el transporte SMTP. Los tickets de prueba tampoco pueden responder al cliente después de cambiar el entorno a `live`.
6. Activar `MODE=live` sólo al validar el canal real. El cambio de modo tiene su propio punto de activación, sin recuperar historia anterior. Mantener Zammad paralelo hasta aceptar la operación de Agentec; coordinar cuál sistema responde para evitar respuestas humanas duplicadas.

`npm run mail:tickets -- --status` consulta el estado sin descargar ni enviar mensajes. La pantalla Configuración muestra última ejecución correcta, error y estados de la cola. Un cambio de UIDVALIDITY requiere revisar el punto de activación: no se reinicia automáticamente ni importa mensajes históricos.

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

Pruebas de dominio, SQLite, PostgreSQL con PGlite y correo con adaptadores simulados: `node --test tests/tickets-store.test.cjs tests/ticket-mail.test.cjs`. La integración HTTP se verifica en `tests/security.integration.test.cjs`. Los datos usados en verificación visual son ficticios.

Validación del 22/10/2026: compilación de producción aprobada; 32 pruebas del almacenamiento de Tickets y 18 de correo aprobadas; 43 comprobaciones de interfaz, permisos y compatibilidad aprobadas; 11 controles UX aprobados. La prueba en navegador cubrió alta, revisión y aporte a un duplicado, asignación, prioridad, resolución, reapertura y guardado de configuración, además de escritorio, móvil y tema oscuro.

La suite general no queda completamente verde: conserva cinco fallos reproducidos también sobre `HEAD 6d6c5af`, anteriores a Tickets (descripción de botón en horarios mensuales, historial de configuración, selector de equipos mensuales y dos pruebas de controles vehiculares). La aserción de compatibilidad que aún esperaba el texto «Seguimientos» se actualizó a «Tickets» y sus cuatro pruebas volvieron a pasar. Estos fallos anteriores no se ocultan ni se modifican como parte del módulo.

La conexión real a GoDaddy, el scheduler, las pruebas con mensajes reales y la decisión de habilitar correo operativo requieren configuración del entorno. No se hicieron envíos reales ni cambios en Zammad. La publicación requiere el despliegue normal del proyecto y revisión de permisos de los roles que participarán.
