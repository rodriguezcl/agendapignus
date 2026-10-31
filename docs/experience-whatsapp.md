# Postventa de instalación por WhatsApp

Al pasar una instalación de alarma a Completado se programa una invitación a contar la experiencia y dejar una reseña. Se usa el mismo criterio que el correo de postventa, con los técnicos participantes. En varias jornadas se genera una sola invitación al cierre final vigente. No se envían mensajes retroactivos al activar el canal ni por ediciones de un servicio ya completado.

El evento se guarda en la misma transacción del servicio, en la cola de WhatsApp existente. El correo mantiene su funcionamiento independiente. Antes del envío se verifica que la instalación continúe completada; una cancelación, reapertura, cambio de cuenta o reclasificación descarta el aviso pendiente. Los mensajes ya aceptados por GoHighLevel no se pueden retirar desde Agenda.

Los avisos y errores aparecen en la ficha del cliente, en **Avisos de instalación → WhatsApp · Experiencia y reseña de la instalación**, con los permisos existentes. Un teléfono ausente o inválido genera un aviso para Administración. Al corregir el contacto, el proceso periódico recupera ese aviso existente; no recorre instalaciones antiguas para generar nuevos avisos.

## Plantilla propuesta

- Nombre: `postventa_instalacion_alarma`.
- Idioma: español.
- Categoría propuesta: Utility / Servicio público, por tratarse de seguimiento de una instalación concreta; la aprobación y clasificación final corresponde a Meta.
- Encabezado: ninguno.

```text
Hola, {{1}}. Somos Pignus Guardianes por Naturaleza.

Luego de la instalación de tu alarma, realizada por {{2}}, queremos saber: ¿salió todo bien? ¿Te quedó clara la explicación sobre cómo usarla?

Podés responder a este mensaje para contarnos tu experiencia o cualquier duda.

También te invitamos a compartir tu experiencia en Google.

¡Gracias por confiar en Pignus!
```

Variables de plantilla: `{{1}}` → nombre del contacto (ejemplo: Ana); `{{2}}` → campo de contacto Técnicos asignados (ejemplo: Pascual y Mariano). Elegir las claves existentes desde el selector de GHL.

Botón de sitio web con URL fija: **Dejar una reseña** → `https://g.page/r/CV2Ab-6e3_B5EBE/review`. La invitación se muestra a todos los destinatarios del seguimiento, independientemente de su opinión; no se condiciona a una respuesta positiva. Las respuestas llegan a la conversación de atención al cliente en GHL; no crean tickets automáticamente.

## Workflow independiente en GoHighLevel

Crear **Postventa de instalación · Agenda técnica**, sin modificar el flujo de confirmación de visita:

1. Webhook entrante nuevo. Guardar su URL como `PIGNUS_GHL_EXPERIENCE_WEBHOOK_URL`, exclusivamente en el servidor. No reutilizar el webhook de confirmación: la aplicación rechaza esa configuración.
2. Seleccionar una muestra del nuevo evento `installation.completed.experience` como referencia de mapeo.
3. Crear o actualizar contacto. Mapear desde **Inbound Webhook Trigger**:

| Campo de contacto | Valor del webhook |
|---|---|
| First name | firstName |
| Last name | lastName |
| Email | email |
| Phone | phone |
| Técnicos asignados | technicians |

4. Acción WhatsApp: seleccionar `postventa_instalacion_alarma` aprobada y el número conectado de atención al cliente. Respetar preferencias de contacto y restricciones de WhatsApp. No se requieren ramas de respuesta rápida para el botón de enlace.
5. Webhook saliente **POST** a `https://agenda.pignusarg.com/api/appointments/whatsapp/receipt`, con datos personalizados `eventId` → **Inbound Webhook Trigger.Event Id** y `receiptToken` → **Inbound Webhook Trigger.Receipt Token**. Son variables del activador, no campos de contacto ni textos fijos. Se reutiliza el endpoint firmado existente, que admite ambos tipos de aviso.

Permitir reingreso para futuras instalaciones. No añadir esperas entre las acciones: los campos de contacto son compartidos con confirmaciones. Agenda serializa ambos tipos de aviso para un mismo teléfono o correo hasta recibir el callback. El callback confirma el fin del flujo, no la entrega del mensaje al dispositivo.

## Activación y prueba

Variables privadas, independientes del canal de confirmación:

```dotenv
PIGNUS_GHL_EXPERIENCE_ENABLED=false
PIGNUS_GHL_EXPERIENCE_WEBHOOK_URL=<nuevo webhook entrante de postventa>
```

Se reutilizan `PIGNUS_SESSION_SECRET`, el scheduler `/api/tickets/mail/process` y su bloqueo compartido. No requiere otro cron, SMTP activo ni nuevas tablas. Mantener desactivado hasta configurar la plantilla, publicar el workflow y verificar una prueba interna autorizada. Después activar `PIGNUS_GHL_EXPERIENCE_ENABLED=true`. No envía por su cuenta mensajes a instalaciones completadas mientras el canal estaba desactivado.

Para generar la referencia de mapeo, con el nuevo workflow en borrador y variables locales configuradas:

```powershell
node --env-file=.env.local scripts/test-appointment-whatsapp.cjs --experience --sample
```

La muestra lleva teléfono vacío y datos ficticios. No usarla como prueba de entrega. Tras desplegar y publicar el workflow, realizar una sola prueba con número interno autorizado:

```powershell
node --env-file=.env.local scripts/test-appointment-whatsapp.cjs --experience --send-test --phone=NUMERO_INTERNO_CON_CODIGO_PAIS
```

Verificar mensaje, nombres, botón y último paso en GHL. El script no consulta clientes ni crea servicios. HTTP 200 no acredita entrega. No repetir automáticamente una prueba incierta.

Una respuesta 429 permite reintentos limitados. Errores ambiguos, interrupciones y falta de callback se revisan manualmente para evitar duplicados; se comparte el mecanismo documentado en [confirmaciones de WhatsApp](appointment-whatsapp.md).

## Validación

Para instalaciones de cámaras y visitas mixtas, consultar [avisos de cámaras](camera-installation-notices.md). Utilizan plantillas y webhooks separados de los de alarmas.

`tests/experience-whatsapp.test.cjs`, junto con `tests/appointment-whatsapp.test.cjs` y `tests/installation-experience.test.cjs`: transiciones de estado, jornadas, deduplicación, contactos, firma, serialización entre flujos, pausas independientes y SQLite/PostgreSQL.

Referencias oficiales: [categorías de plantillas](https://help.gohighlevel.com/support/solutions/articles/155000001058-template-categorisation-guidelines), [solicitudes de reseñas por WhatsApp](https://help.gohighlevel.com/support/solutions/articles/155000004326-how-to-send-review-request-via-whatsapp).
