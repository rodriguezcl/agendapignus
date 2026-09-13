# Informe final UX/UI — Agenda Pignus

Documento normativo evaluado: [Constitución UX/UI](./UX-UI-CONSTITUTION.md).

Fecha de evaluación: 13 de septiembre de 2026.

## Resultado

Las seis acciones del relevamiento establecieron una base compatible con la Constitución UX/UI sin modificar reglas de negocio, contratos API, modelos, autenticación, autorización ni concurrencia.

El Quality Gate automatizado pondera las nueve categorías constitucionales y exige simultáneamente:

- puntaje mínimo de 90/100;
- ningún control crítico fallido;
- compilación productiva correcta;
- suite funcional completa sin regresiones.

El puntaje automatizado no reemplaza pruebas con usuarios ni una auditoría instrumental de contraste. Sirve como barrera de regresión reproducible.

## Evaluación por superficie

| Superficie | Perfil | Puntaje | Evidencia principal |
| --- | --- | ---: | --- |
| Agenda semanal | Administrador | 93 | Alta densidad, contexto preservado, controles por servicio, navegación y foco accesibles. |
| Agenda del día | Administrador | 94 | Validación preventiva, acciones jerarquizadas, guardado visible y conflictos explicados. |
| Historial | Administrador | 93 | Encabezado persistente, paginación, búsqueda, gestión individual y múltiple. |
| Abonados y clientes | Administrador | 92 | Búsqueda, paginación, importación confirmada y estados vacíos explicativos. |
| Agenda técnica | Técnico móvil | 95 | Próximo servicio prioritario, siguientes servicios resumidos, acciones directas y objetivos táctiles. |

Todos los valores superan el mínimo constitucional de 90. La revisión productiva del portal técnico confirmó el estado de carga, el estado vacío, la navegación específica del rol y el contenido operacional visible.

## Cobertura del Quality Gate

- Usabilidad: paginación, acciones directas, estados vacíos y detalle progresivo.
- Accesibilidad: foco contenido y restaurado, objetivos táctiles, movimiento reducido y anuncios ARIA.
- Eficiencia: priorización móvil, gestión múltiple y densidad controlada.
- Arquitectura de información: jerarquía próxima/siguientes y navegación semántica.
- Prevención de errores: campos críticos y bloqueo durante guardado confirmado.
- Consistencia: tokens y patrón único para estados del sistema.
- Jerarquía visual: acciones primarias, secundarias y destructivas diferenciadas.
- Responsive: composición específica para pantallas táctiles.
- Feedback: notificaciones según resultado y estados explícitos de espera.

## No regresión

Se conservaron tareas, acciones, información, estados y permisos existentes. Las comprobaciones obligatorias son:

1. `npm run test:ux`
2. `npm run build`
3. `npm test`
4. verificación de los recursos publicados en `agenda.pignusarg.com`

## Deuda residual controlada

- Las hojas históricas todavía contienen valores visuales literales y reglas `!important`. Deben migrarse por componente, nunca mediante reemplazo masivo.
- El bundle principal continúa por encima de 500 kB sin comprimir. Conviene dividir módulos administrativos en cargas diferidas en una etapa técnica independiente.
- La medición de contraste debe complementarse con una auditoría automatizada en navegador sobre cada tema y breakpoint.
- Los puntajes deben reevaluarse con evidencia de uso real, tiempos de tarea e incidentes de soporte.

Estas deudas no eliminan funciones ni impiden las tareas críticas, pero permanecen registradas para evitar que se confundan con trabajo terminado.
