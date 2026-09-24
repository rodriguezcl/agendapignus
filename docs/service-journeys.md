# Servicios planificados en varias jornadas

Implementación verificada automáticamente. Commit y despliegue autorizados por el usuario el 21/09/2026; la revisión visual interactiva sigue pendiente.

## Funcionamiento implementado

- Guardar primero el servicio pendiente y utilizar «Planificar varias jornadas».
- Reservar explícitamente entre 2 y 20 fechas, con hora, duración y equipo por visita. No hay traslado automático al día siguiente.
- La primera visita conserva fecha, hora y equipo; se puede ajustar su duración.
- Guardado conjunto con validación de disponibilidad: un conflicto impide guardar todo el plan.
- Las visitas intermedias permiten «Registrar avance»; la última permite completar el servicio. El avance libera al técnico y no incrementa los servicios completados.
- Se conserva la identificación de las jornadas en agendas, historial e informes. Al eliminar de la agenda una jornada pendiente que ya no se necesita, se cancela su reserva y se conserva en el historial. Las jornadas ya canceladas o informadas también pueden retirarse de la agenda sin perder sus informes ni modificar las otras visitas. Una jornada iniciada debe informarse o cancelarse desde el historial antes de retirarla.
- Las reuniones mensuales y controles vehiculares no admiten este plan.
- La confirmación y la reprogramación son por visita; la reprogramación conserva el orden de las fechas.

## Identidad compartida

Cliente y tipo de servicio se actualizan conjuntamente en todas las jornadas antes de comenzar el trabajo. Cuando cualquier visita tiene inicio o gestión registrada, esos campos quedan protegidos. La vinculación de una reserva PIG con su cuenta definitiva permanece disponible como excepción independiente y conserva los informes y datos provisorios originales. Cada visita conserva sus fechas, equipos, duración y notas. El servidor aplica la misma regla a las escrituras y rechaza cambios contradictorios.

## Verificación

- Suite completa: 580 pruebas aprobadas, sin fallos, incluyendo identidad compartida y protección posterior al inicio.
- Compilación de producción aprobada; advertencia de tamaño del paquete principal.
- Pruebas de renderizado de componentes y recorrido local de API con técnico, avance y cierre.
- La revisión visual interactiva quedó pendiente: el navegador integrado no pudo abrir la página local tras dos intentos. Se retiró el material temporal de prueba.

## Antes del despliegue

Completar revisión visual. La migración `node --env-file-if-exists=.env.local scripts/migrate-service-journeys.cjs --apply` agrega el estado «Avance registrado» al esquema normalizado y debe ejecutarse en el entorno correspondiente antes de habilitar la funcionalidad. No revertir el esquema mientras existan registros con el nuevo estado. El resultado de ejecución y la publicación se verifican en la tarea de despliegue.
