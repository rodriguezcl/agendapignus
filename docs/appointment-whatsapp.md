# Confirmaciones de visita por correo y WhatsApp

Las instalaciones de alarma confirmadas generan un aviso por canal. Incluye cliente, fecha, hora, domicilio y técnicos asignados. Un servicio «A confirmar» no genera el aviso. La confirmación del formulario, el alta PIG y la invitación posterior a dejar una reseña conservan sus eventos independientes.

## Comportamiento

- Al guardar una instalación confirmada, o confirmar una reserva, se encola el aviso en la misma transacción del servicio.
- El correo requiere una dirección válida; puede incorporarse posteriormente mediante el formulario. WhatsApp requiere un teléfono válido, independiente del correo.
- Una edición común no repite el envío. Una nueva fecha/hora genera otra confirmación. Las visitas anteriores a hoy no se envían por WhatsApp.
- En varias jornadas se comunica solamente la primera jornada vigente; no se envía una confirmación por cada día.
- Antes de despachar se vuelve a consultar el servicio: se descartan avisos de visitas canceladas, iniciadas, completadas, con cambio de destinatario o fecha/hora.
- Los mensajes ya aceptados por GHL no pueden retirarse desde Agenda. Un cambio posterior requiere revisar la ejecución en GHL.
- Los dos canales usan el proceso periódico existente `/api/tickets/mail/process` y su bloqueo compartido. WhatsApp funciona aunque SMTP esté desactivado. No ejecutar workers de WhatsApp paralelos fuera de ese bloqueo.

## Configuración del servidor

Mantener el webhook en variables privadas del servidor, nunca en variables `VITE_*`, archivos públicos ni commits:

```dotenv
PIGNUS_GHL_ENABLED=false
PIGNUS_GHL_WEBHOOK_URL=<URL del activador entrante proporcionada por GHL>
```

También se requiere `PIGNUS_SESSION_SECRET` existente, de al menos 32 caracteres. Se usa una firma HMAC específica por evento para autenticar el retorno del flujo. Rotar este secreto invalida confirmaciones de ejecuciones anteriores; revisar los avisos que queden inciertos.

Primero desplegar con el canal desactivado. Crear las variables en producción, verificar el workflow y realizar una única prueba interna. Activar `PIGNUS_GHL_ENABLED=true` solamente después. La activación no recorre servicios viejos ni envía avisos retroactivos; afecta las confirmaciones guardadas desde ese momento. Verificar que el scheduler existente esté operativo.

## Flujo GoHighLevel

1. **Webhook entrante**, con una muestra del script indicado abajo. Seleccionar la última solicitud como referencia de mapeo. Conservar el nombre de las propiedades.
2. **Crear o actualizar contacto**, mapear los valores desde **Inbound Webhook Trigger**, no desde el mismo contacto:

| Campo del contacto | Campo del webhook |
|---|---|
| First name | firstName |
| Last name | lastName |
| Email | email |
| Phone | phone |
| Fecha de instalación | appointmentDateText |
| Horario de instalación | appointmentTime |
| Domicilio de instalación | address |
| Técnicos asignados | technicians |

Los últimos cuatro son campos de Contacto de una sola línea. Las claves generadas por GHL pueden variar: elegirlas con el selector, sin escribir nombres supuestos.

3. **WhatsApp**: plantilla aprobada `confirmacion_instalacion_alarma` en español, categoría Utility. Variables: nombre del contacto, fecha, horario, domicilio, técnicos. Elegir el número de atención al cliente conectado. Desactivar ramas de respuestas rápidas si la plantilla no tiene botones. Respetar las preferencias de contacto y las restricciones de WhatsApp del contacto.
4. **Webhook** estándar, después de la acción WhatsApp, método **POST**, URL:

   `https://agenda.pignusarg.com/api/appointments/whatsapp/receipt`

   Agregar estos datos personalizados usando los valores del activador entrante:

| Clave del dato personalizado | Valor dinámico |
|---|---|
| eventId | Inbound Webhook Trigger → Event Id |
| receiptToken | Inbound Webhook Trigger → Receipt Token |

No crear campos de contacto para estos dos valores. El endpoint admite el cuerpo plano y el objeto `customData` del webhook estándar. No hace falta agregar credenciales en headers: la firma permite confirmar únicamente ese evento, no consultar datos ni modificar servicios. No escribir el token de ejemplo literalmente.

El callback confirma que el flujo llegó a su último paso, **no** que WhatsApp entregó el mensaje. Si la acción WhatsApp falla y no llega al último paso, revisar el historial. No agregar esperas ni otras acciones de comunicación entre esos pasos. Permitir reingreso al workflow para futuras visitas, manteniendo la serialización desde Agenda.

## Evitar cruces entre visitas del mismo contacto

La plantilla usa campos mutables de contacto. Agenda retiene el siguiente aviso para el mismo teléfono o correo mientras el anterior está enviándose, aceptado o incierto. El callback libera el siguiente. A los 30 minutos sin callback pasa a revisión; no reenvía automáticamente.

En la ficha del abonado, «Avisos de instalación» muestra el estado de cada canal. Una persona con permiso de gestión puede finalizar una revisión incierta **después de comprobar que el flujo terminó o fue detenido en GHL**. Esto libera avisos posteriores, deja actor/fecha en el historial y no reenvía ni afirma que se entregó el mensaje.

HTTP 429 se reintenta con espera y hasta cinco intentos. Errores de red, timeout o HTTP 5xx se consideran inciertos: un reintento ciego podría duplicar un mensaje ya aceptado. HTTP 4xx queda rechazado. Una respuesta «test request received» se identifica como muestra/borrador, no como envío operativo.

## Muestra y prueba interna

Con las variables configuradas en `.env.local` (archivo excluido de Git):

```powershell
node --env-file=.env.local scripts/test-appointment-whatsapp.cjs --sample
```

La muestra no lleva teléfono ni datos de clientes. Refrescar la referencia de mapeo en GHL después de enviarla. No publica el workflow.

Con el flujo publicado y el endpoint desplegado, realizar **una única** prueba con un número propio autorizado:

```powershell
node --env-file=.env.local scripts/test-appointment-whatsapp.cjs --send-test --phone=NUMERO_INTERNO_CON_CODIGO_PAIS
```

El script utiliza nombre, fecha, domicilio y técnicos ficticios, con texto «PRUEBA SIN VISITA REAL». No consulta clientes ni crea servicios. `isTest=true` permite identificar la ejecución. Su evento no está en la cola de servicios, por lo que el callback válido devuelve OK sin modificar registros operativos. No repetir automáticamente: revisar la conversación y los registros de GHL. HTTP 200 no prueba entrega al teléfono.

## Validación

Pruebas de dominio, cola SQLite/PostgreSQL, cancelaciones, destinatarios, deduplicación, permisos, firmas de retorno, callback anticipado, contactos con varias visitas y recuperación de resultados inciertos: `tests/appointment-whatsapp.test.cjs`. Ejecutar también las suites de correo, reservas y confirmación de registro.

Documentación oficial: [Webhook entrante](https://help.gohighlevel.com/support/solutions/articles/48001237383), [acción WhatsApp](https://help.gohighlevel.com/support/solutions/articles/155000003531), [Webhook saliente](https://help.gohighlevel.com/support/solutions/articles/155000003299).
