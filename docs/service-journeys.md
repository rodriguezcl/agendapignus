# Servicios planificados en varias jornadas

Implementación verificada automáticamente. Commit y despliegue autorizados por el usuario el 21/09/2026; la revisión visual interactiva sigue pendiente.

## Funcionamiento implementado

- Guardar primero el servicio pendiente y utilizar «Planificar varias jornadas».
- Reservar explícitamente entre 2 y 20 fechas, con hora, duración y equipo por visita. No hay traslado automático al día siguiente.
- La primera visita conserva fecha, hora y equipo; se puede ajustar su duración.
- Guardado conjunto con validación de disponibilidad: un conflicto impide guardar todo el plan.
- Las visitas intermedias permiten «Registrar avance»; la última permite completar el servicio. El avance libera al técnico y no incrementa los servicios completados.
- Las etiquetas operativas cuentan únicamente las jornadas no canceladas. Si queda una sola, no se muestra etiqueta de jornadas. La última jornada vigente permite completar el servicio; si ya tenía un avance, Administración puede cerrarlo explícitamente desde el historial. Cancelar una visita nunca convierte automáticamente un avance en servicio completado. La planificación original permanece en el detalle del historial.
- Se conserva la identificación de las jornadas en agendas, historial e informes. Al eliminar de la agenda una jornada pendiente que ya no se necesita, se cancela su reserva y se conserva en el historial. Las jornadas ya canceladas o informadas también pueden retirarse de la agenda sin perder sus informes ni modificar las otras visitas. Una jornada iniciada debe informarse o cancelarse desde el historial antes de retirarla.
- Las reuniones mensuales y controles vehiculares no admiten este plan.
- La confirmación y la reprogramación son por visita; la reprogramación conserva el orden de las fechas.

## Identidad compartida

Cliente y tipo de servicio se actualizan conjuntamente en todas las jornadas antes de comenzar el trabajo. Cuando cualquier visita tiene inicio o gestión registrada, esos campos quedan protegidos. La vinculación de una reserva PIG con su cuenta definitiva permanece disponible como excepción independiente y conserva los informes y datos provisorios originales. Cada visita conserva sus fechas, equipos, duración y notas. El servidor aplica la misma regla a las escrituras y rechaza cambios contradictorios.

## Liberar una jornada para otro cliente

1. En Agenda semanal, abrir la tarjeta de la jornada pendiente que se quiere liberar y elegir **Quitar jornada**. En Agenda diaria, usar la misma acción en la fila del servicio.
2. Confirmar la baja de esa visita. Queda cancelada en el historial y se libera su horario; las otras visitas conservan sus fechas, equipos, informes y archivos.
3. En la franja disponible, elegir **Agregar servicio** y cargar al otro cliente como un servicio independiente.

Por ejemplo, si se quita la tercera visita de un trabajo de cuatro jornadas, las etiquetas pasan a **Jornada 1 de 3**, **Jornada 2 de 3** y **Jornada 3 de 3**. La planificación original conserva los cuatro registros para consultar su trazabilidad. La nueva última jornada admite completar el trabajo cuando las anteriores activas ya fueron informadas.

Cambiar el cliente de una visita no la separa del grupo: ese cambio corresponde a todo el trabajo y se protege cuando ya existe un inicio o informe. La agenda avisa este alcance. Una visita iniciada debe resolverse desde Historial antes de liberar el horario; retirar una tarjeta ya informada conserva su resultado y no la convierte en una cancelación.

El conteo vigente se calcula con el historial completo, también cuando el usuario sólo puede consultar algunas visitas. Es información de lectura: no se persiste desde el navegador ni interviene en la comparación de versiones de un servicio.

## Verificación

- Suite completa: 580 pruebas aprobadas, sin fallos, incluyendo identidad compartida y protección posterior al inicio.
- Compilación de producción aprobada; advertencia de tamaño del paquete principal.
- Pruebas de renderizado de componentes y recorrido local de API con técnico, avance y cierre.
- La revisión visual interactiva quedó pendiente: el navegador integrado no pudo abrir la página local tras dos intentos. Se retiró el material temporal de prueba.

## Antes del despliegue

Completar revisión visual. La migración `node --env-file-if-exists=.env.local scripts/migrate-service-journeys.cjs --apply` agrega el estado «Avance registrado» al esquema normalizado y debe ejecutarse en el entorno correspondiente antes de habilitar la funcionalidad. No revertir el esquema mientras existan registros con el nuevo estado. El resultado de ejecución y la publicación se verifican en la tarea de despliegue.
