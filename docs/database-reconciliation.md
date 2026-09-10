# Conciliación histórica — segunda etapa

## Diagnóstico inicial

Se comparó la revisión productiva **7262** con cinco respaldos guardados en preferencias,
los 100 eventos de auditoría remota disponibles y el historial y la agenda de 11 bases
SQLite locales de `data` y `data/backups`. Todas las conexiones fueron de solo lectura.
En esa lectura inicial no se aplicaron correcciones, migraciones, commits ni despliegues.

Huella del estado: `7193d7320a7e7473b8ab10b8a1e6766d75a52d0213bf602660b09a7a38c4987b`.
Huella del conjunto de evidencia con bases locales:
`4a9bdcb848082817d5695b95ee8c9c13f462546beacf7a6a236844c8e58af56c`.

Los 40 trabajos afectados tienen coincidencias por identificador. Persisten 173 hallazgos
de revisión; 21 son hallazgos de tarjetas sin vínculo (no 21 trabajos nuevos). No se
encontraron vínculos ambiguos ni respaldos ilegibles en este conjunto.

La auditoría remota abarca del 08/09/2026 01:43:41 al 08/09/2026 22:28:04 UTC.
`appendAudit` retiene solo los últimos 100 eventos: no constituye un registro completo
de enero a septiembre. Los archivos locales contienen entre 418 y 505 trabajos. Sus
nombres no certifican su fecha de captura; no se usan como autoridad temporal.
En esta etapa se leyeron historial y agenda de esos archivos, no su auditoría local.

## Diferenciar historial de copias de agenda

Al comparar exclusivamente con los historiales locales —sin contar las tarjetas de
agenda como si fueran otra confirmación independiente— se obtiene:

| Campo cuestionado | Coincide con el historial local disponible | Tiene variantes o difiere | Sin evidencia local de historial |
| --- | ---: | ---: | ---: |
| Fecha | 29 | 8 | 0 |
| Estado | 7 | 1 | 0 |
| Equipo | 8 | 9 | 0 |
| Técnicos | 11 | 8 | 3 |

Son comparaciones por campo; los grupos se superponen. Coincidencia significa
**corroboración, no certificación ni autorización de reparación**. No se vota por la
cantidad de copias y no se presume que una variante histórica sea necesariamente un error.

### Casos de fecha prioritarios

- **7 trabajos:** el historial actual indica **18/04/2026**, mientras que los historiales
  locales coincidentes indican **18/08/2026**. Debe corroborarse la fecha real antes de
  modificar indicadores mensuales o eliminar apariciones de agenda.
- **1 trabajo:** actualmente **14/08/2026**, con variantes históricas **12, 13 y 14/08**.
  Puede haber reprogramaciones legítimas; no corresponde elegir automáticamente la primera.
- Los otros **29** tienen la fecha actual respaldada por los historiales locales, aunque
  siguen existiendo apariciones en otras fechas en agenda.

También hay ocho diferencias de estado frente a agenda: siete completados están
corroborados por los historiales locales; uno tiene tanto Pendiente como Completado en
sus antecedentes. Una transición de estado es normal y no implica por sí misma corrupción.

## Interpretación técnica

Las discrepancias entre historial y agenda ya están presentes en las fuentes locales;
por ello no es seguro sustituir toda la base por una de esas copias. La evidencia muestra
representaciones divergentes del mismo identificador, pero no demuestra por sí sola qué
acción originó cada divergencia ni cuál fue la fecha efectiva del servicio.

La individualización del trabajo y las relaciones normalizadas evitan mantener varias
copias editables como fuentes de verdad. No obstante, una migración estructural no puede
deducir las fechas, estados o técnicos correctos de registros históricos ambiguos.

## Herramienta reproducible

```powershell
npm run reconcile:normalization -- --production-read-only
npm run reconcile:normalization -- --production-read-only --local-backups --details
npm run reconcile:normalization -- --file evidencia.json --details
```

El archivo opcional tiene forma `{ "state": {...}, "backups": [{"key":"...",
"value": {...}}], "audit": [...] }`. No se genera ni se guarda una copia de producción
automáticamente. La salida detallada individualiza registros por ID, campo y referencias
de origen; omite nombres, contactos, notas y credenciales. No subir archivos de evidencia
sin depuración a Git. Las bases SQLite se abren con `readOnly: true`.

Cada variante conserva fuente, fecha del evento si existe, ubicación exacta y tipo
de representación. Los enlaces contradictorios se señalan sin emparejar por semejanza
de cliente, nombre, fecha u orden de equipo. La herramienta no tiene opción de aplicación.

La suite final de la etapa reúne **306 pruebas aprobadas**. Las pruebas de conciliación cubren inmutabilidad,
identidad ambigua, respaldos ilegibles, ausencia de datos, distinción historial/agenda,
separación antes/después y ausencia de decisiones por mayoría de copias.

## Decisión necesaria antes de corregir datos

Contrastar especialmente los siete trabajos abril/agosto con una fuente operativa
autorizada (agenda original exportada, orden o constancia de trabajo). Para el caso con
tres fechas, corroborar si fue reprogramado y cuál fue su realización efectiva. Los IDs y
las rutas de cada evidencia se obtienen mediante `--details`.

No cambiar fechas, técnicos ni indicadores hasta resolver esas decisiones. Es posible
seguir preparando el modelo y las pruebas en paralelo sin activar el reemplazo de datos.
Las correcciones aprobadas deberán ser por ID, con control de versión, respaldo de los
valores anteriores y comparación del efecto en cada indicador.

## Confirmaciones recibidas y vista previa del 9 de septiembre

El usuario confirmó individualmente los siete trabajos como realizados el **18/08/2026**
y ratificó sus técnicos actuales: Julio Beccaria, Costa Verde y Silvina Gauna por Leonardo
Rivadero; Geraldine Balbi, Ignacio Diaz Mandis y Antigua Estancia por Rodrigo Gonzalez;
Kevin Molina por Pascual Gonzalez. También confirmó que Emiliano Monaco (01/04) fue
realizado únicamente por Rodrigo Gonzalez.

Para Costa Verde, instalación de mangueras con UTP y fibra, confirmó **14/08/2026** y
estado **Completado**. Los otros siete estados/completados del 14/08 coinciden entre el
historial actual y los historiales locales; sus tarjetas pendientes del 16/08 son copias
de agenda, no antecedentes independientes. Los controles del 04/09 fueron confirmados:
Kangoo/Mariano, Partner/Santos y Ford Ka/Leonardo.

Las decisiones están individualizadas en `scripts/reconciliation-decisions-20260909.json`.
La vista previa sobre la revisión productiva 7270 no realizó escrituras y produjo:

- 581 trabajos antes y después.
- Completados de abril: 36 → 29; agosto: 117 → 124.
- Diferencias de fecha: 52 → 35; equipo: 24 → 14; técnicos: 31 → 21.
- Diferencias de estado: 8 → 0; apariciones en varias semanas: 37 → 21.
- Fechas de agenda tocadas en la copia: 01/04, 18/04, 14/08 y 18/08.

La transformación elimina únicamente las apariciones del servicio confirmado, conserva
los trabajos vecinos, agrupa por conjunto exacto de técnicos y falla si cambió cualquier
valor esperado, desapareció un técnico o falta una tarjeta.

## Aplicación autorizada y estado final

Tras las confirmaciones individuales, las reparaciones se aplicaron con bloqueo de
revisión, comparación de valores esperados y respaldo previo:

- revisión 7270 → 7271, respaldo `backup_confirmed_reconciliation_20260909`;
- revisión 7271 → 7272, respaldo `backup_projection_reconciliation_20260909`;
- revisión 7272 → 7273, eliminación de la tarjeta no realizada de Fabricio Molina,
  respaldo `backup_remove_unperformed_agenda_card_20260907`;
- revisión 7273 → 7274, recuperación de nueve controles vehiculares futuros que tenían
  tarjeta de agenda pero carecían de registro, respaldo
  `backup_restore_scheduled_vehicle_controls_20260909`.

El cierre de conciliación conserva 594 trabajos: 580 completados, 13 pendientes y uno
cancelado. El analizador no encuentra errores ni casos de revisión pendientes. Quedan
solamente 570 fechas exactas de finalización desconocidas y 17 identificadores de tarea
antiguos ausentes; se mantienen nulos porque no existe evidencia para inventarlos.
