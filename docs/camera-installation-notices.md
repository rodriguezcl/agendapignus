# Avisos de instalaciones de cámaras

La confirmación se genera al guardar una visita confirmada de instalación de cámaras (no mientras esté A confirmar). La postventa se genera cuando una instalación existente pasa a Completado. Los servicios de reparación y retiro no disparan estos avisos.

Los correos utilizan el canal SMTP existente. Incluyen los técnicos asignados; la postventa incluye un enlace clicable a la reseña. Una visita con instalación de alarma y cámaras genera un solo aviso por etapa y canal, con texto que menciona ambas instalaciones. En varias jornadas se confirma la primera visita y se invita a dejar una reseña al completar la última; un cierre parcial considera únicamente los trabajos completados.

## GoHighLevel

Crear dos flujos independientes de los de alarmas. Cada uno debe seguir este orden, sin esperas entre pasos:

1. Webhook entrante.
2. Crear o actualizar contacto con los datos dinámicos del webhook.
3. Enviar la plantilla WhatsApp correspondiente.
4. Webhook POST a `https://agenda.pignusarg.com/api/appointments/whatsapp/receipt`, con `eventId` y `receiptToken` obtenidos del webhook entrante. Este retorno confirma que terminó el flujo; no acredita entrega ni lectura en el teléfono.

Crear un campo de contacto de una sola línea llamado **Instalación a comunicar**. Mapearlo desde **Inbound Webhook Trigger → Installation Description**. Contendrá «tu sistema de cámaras» o «tu alarma y tu sistema de cámaras» en las visitas mixtas. No escribir el nombre de la variable como texto literal.

Mapear también First Name, Last Name, Phone y Email desde el webhook. En confirmación, mapear Fecha de instalación desde Appointment Date Text, Horario de instalación desde Appointment Time, Domicilio de instalación desde Address y Técnicos asignados desde Technicians. En postventa, actualizar Técnicos asignados desde Technicians.

### Plantilla de confirmación

Nombre: `confirmacion_instalacion_camaras`. Idioma: español. Sin encabezado obligatorio.

```text
Hola, {{1}}. Somos Pignus Guardianes por Naturaleza.
Te confirmamos la visita técnica para instalar {{2}}.

📅 Fecha: {{3}}
🕘 Horario: {{4}} hs
📍 Domicilio: {{5}}
👷 Técnicos asignados: {{6}}

Si necesitás modificar la visita o agregar alguna indicación para el ingreso, respondé a este mensaje.

¡Gracias por confiar en Pignus!
```

| Variable | Campo de contacto | Ejemplo para aprobación |
|---|---|---|
| 1 | Nombre | Ana |
| 2 | Instalación a comunicar | tu sistema de cámaras |
| 3 | Fecha de instalación | lunes 2 de noviembre de 2026 |
| 4 | Horario de instalación | 09:00 |
| 5 | Domicilio de instalación | Av. Colón 1234, Córdoba |
| 6 | Técnicos asignados | Pascual y Mariano |

### Plantilla de postventa

Nombre: `postventa_instalacion_camaras`. Idioma: español.

```text
Hola, {{1}}. Somos Pignus Guardianes por Naturaleza.

Luego de la instalación de {{2}}, realizada por {{3}}, queremos saber: ¿salió todo bien? ¿Te quedó clara la explicación sobre cómo usar el sistema?

Podés responder a este mensaje para contarnos tu experiencia o cualquier duda.

También te invitamos a compartir tu experiencia en Google.

¡Gracias por confiar en Pignus!
```

| Variable | Campo de contacto | Ejemplo para aprobación |
|---|---|---|
| 1 | Nombre | Ana |
| 2 | Instalación a comunicar | tu sistema de cámaras |
| 3 | Técnicos asignados | Pascual y Mariano |

Agregar botón **Dejar una reseña** con URL fija `https://g.page/r/CV2Ab-6e3_B5EBE/review`. WhatsApp decide en qué navegador abre el enlace.

## Configuración y activación

Guardar las dos URL privadas en el entorno del servidor:

```text
PIGNUS_GHL_CAMERAS_WEBHOOK_URL=<webhook de confirmación de cámaras>
PIGNUS_GHL_CAMERAS_EXPERIENCE_WEBHOOK_URL=<webhook de postventa de cámaras>
PIGNUS_GHL_CAMERAS_ENABLED=true
PIGNUS_GHL_CAMERAS_EXPERIENCE_ENABLED=true
```

Ambas funciones están desactivadas por defecto y requieren URL distintas entre sí y distintas de las de alarmas. Comparten la firma de retorno y la protección contra duplicados existentes. No se utiliza el flujo de alarmas como alternativa si falta configurar cámaras.

Para obtener muestras de mapeo, con las URL cargadas en el entorno local:

```powershell
node --env-file=.env.local scripts/test-appointment-whatsapp.cjs --cameras --sample
node --env-file=.env.local scripts/test-appointment-whatsapp.cjs --cameras --experience --sample
```

Las muestras no llevan teléfono. Mantener los flujos en borrador durante el mapeo. Tras aprobar las plantillas, desplegar el código, publicar los flujos y realizar una prueba expresamente autorizada a un número interno antes de activar los flags de producción. No activar un flujo de cámaras con una plantilla exclusiva de alarmas.

La activación no envía postventa retroactiva a instalaciones ya completadas. Los avisos previamente encolados conservan su estado; los envíos de resultado incierto requieren revisión, para evitar duplicarlos.
