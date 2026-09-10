# Normalización: modelo relacional completo y ensayo aislado

Continuación: [conciliación histórica y resultados de la segunda etapa](database-reconciliation.md)
y [plan de migración, corte y reversión](database-cutover-plan.md).

## Alcance

Se preparó un analizador reproducible y un modelo relacional de sombra. La aplicación
sigue usando su esquema actual. No se migró ni modificó producción, ni se activó una
nueva fuente de datos. El SQL está en `supabase/proposals`, fuera de las migraciones
operativas: **no debe ejecutarse manualmente en producción**.

El ensayo usa PostgreSQL en memoria mediante PGlite; cierra la conexión remota de
lectura antes de importar la copia en memoria. No admite una base de destino ni una
opción de aplicación remota. La transacción de origen es `REPEATABLE READ, READ ONLY`.

## Modelo propuesto para el ensayo

- Trabajos individuales con ID estable, versión, fecha, estado, duración y referencias.
- Catálogos completos de clientes, campos de importación, tipos de servicio, empleados,
  permisos por rol y vehículos.
- Equipos por fecha y asignaciones de técnicos mediante relaciones independientes.
- Planes semanales y diarios, espacios disponibles, configuraciones mensuales,
  asignaciones de vehículos, guardias anuales y excepciones de feriados.
- Reservas, checklist, eventos de creación/reporte y el subtipo de control vehicular.
- Claves foráneas, unicidad y restricciones de duración y estado.
- Evidencia original del historial y de cada aparición en agenda, sin descartar copias
  discrepantes; casos de conciliación independientes de los trabajos.

El historial se utiliza para construir un **candidato**, no como declaración de que
siempre tiene razón frente a la agenda. Los trabajos con diferencias quedan marcados
para revisión. Las composiciones de equipo incompatibles no se unen artificialmente.
Las fechas de finalización y los identificadores de tarea desconocidos permanecen nulos.
No se promueven automáticamente borradores ni controles de vehículos a trabajos.

Además de las tablas operativas, el ensayo conserva evidencia inmutable de catálogos,
historial, planes y configuración para permitir comparación y reversión. Las contraseñas
y hashes de empleados se excluyen expresamente: la identidad y las sesiones requieren
una migración de seguridad separada. Auditoría, sesiones y archivos binarios siguen fuera
del candidato y deben resolverse antes del corte.

## Resultado observado el 9 de septiembre de 2026

Revisión de origen: `7274`.

Huella de la instantánea analizada:
`ad78af71348ed9f055cb86d63c491f964f17075e6d91478b5500bd57e2db06a1`.

| Comprobación | Resultado |
| --- | --- |
| Trabajos originales y candidatos | 594 / 594 |
| Estados | 580 completados, 13 pendientes, 1 cancelado |
| Clientes | 1209 |
| Apariciones de agenda preservadas | 632 |
| Planes de agenda preservados | 171 |
| Asignaciones de técnicos | 1210 |
| Campos del origen comercial | 24944 |
| Integridad del contenido original del historial | Huella idéntica tras importar y leer |
| Evidencia de catálogos, planes y configuración | Huella idéntica tras importar y leer |
| Totales mensuales de completados | Idénticos antes y después |
| Errores bloqueantes de integridad detectados | 0 |
| Hallazgos para revisión | 0 |
| Hallazgos informativos | 587 |

Los informativos son 570 completados sin hora/fecha de finalización registrada y 17
registros antiguos sin identificador de tarea. No se inventaron valores para completarlos.

Verificación de código: 329 pruebas aprobadas y compilación
de producción correcta. La compilación conserva las advertencias existentes de Vite
sobre su API CJS y el tamaño del paquete JavaScript.

Totales mensuales preservados: enero 124, febrero 124, marzo 37, abril 29, mayo 34,
junio 28, julio 35, agosto 124 y septiembre 45. Esta comprobación no certifica todavía
todas las métricas (por ejemplo, instalaciones por ubicación), ni demuestra que el origen
contenga todos los servicios históricos que alguna vez existieron.

## Reproducción

```powershell
npm run test:normalization
npm run inventory:normalization
npm run inventory:database-schema
npm run plan:normalization-cutover
npm run analyze:normalization -- --production-read-only --rehearse
npm run analyze:normalization -- --production-read-only --details
npm run analyze:normalization -- --file copia-estado.json --rehearse
```

La lectura remota requiere la configuración habitual de base de datos. `--details`
muestra identificadores y ubicaciones para investigar, no los contenidos originales ni
credenciales. No adjuntar copias de estado con datos personales a repositorios o tickets.
El ensayo se destruye al cerrar su base en memoria; no sustituye a un respaldo.

## Certificación previa a la activación

El ensayo íntegro con rollback se ejecutó satisfactoriamente en un PostgreSQL de staging
separado mediante `STAGING_DATABASE_URL`. Se verificaron DDL, copia física, activación,
escritura posterior al corte, restauración de ambos modelos y retorno a `legacy`; la
transacción completa fue revertida y no modificó staging ni producción.

La certificación está fijada a la revisión productiva `7290` y a la huella
`692ad3384f7f5623dd9d317db5d4783b5de6a9ba6882a7977a79269698c9764c`.
Cualquier cambio posterior de producción exige repetir el ensayo antes del corte.

## Avance del repositorio de sombra

La aplicación ya contiene una proyección de lectura capaz de reconstruir exactamente el
estado seguro (sin credenciales) desde el esquema normalizado. También existe un
sincronizador incremental que exige revisión y huella de base, incrementa la versión del
trabajo modificado, admite reintentos idempotentes y revierte toda la transacción si falla
una restricción. Se probaron modificaciones, altas, bajas, preservación de registros
hermanos, conflictos y rollback.

El selector persistente del servidor admite mantener legado activo o servir el modelo
normalizado después de una activación validada. Antes de instalar el esquema opera en modo
legado compatible; con sombra preparada, todas las escrituras se coordinan atómicamente y
mantienen actualizado el modelo de rollback.

El ensayo aislado también incluye un coordinador de escritura atómica: legado y sombra se
confirman juntos o se revierten juntos. La secuencia probada cubre alta, edición,
reprogramación, completado y baja de servicios, controles vehiculares, catálogos,
importación y deshacer importación, agenda y configuración mensual. El control de origen
valida revisión y huella exactas, registra activación/reversión y conserva una revisión
monotónica. Estas capacidades permanecen desactivadas en producción hasta ejecutar el
procedimiento controlado de migración y activación.

Con la evidencia de staging coincidente, el manifiesto informa `readyForCutover: true` y
no presenta bloqueos de integridad ni implementación. Esto certifica las precondiciones
técnicas de la revisión indicada; no reemplaza la autorización, el respaldo ni la ventana
controlada requeridos para el corte productivo.

## Contraste con el esquema físico

El inventario de metadatos de producción encontró 13 tablas `pignus_*`, todas con RLS.
Sin embargo, las relaciones críticas dependen hoy del código de aplicación: no hay claves
foráneas físicas desde sesiones a empleados, desde historial a clientes y servicios, ni
desde fotos/seguros a trabajos y vehículos. El modelo de sombra declara esas relaciones.

También existe `pignus_vehicle_insurance_documents` en producción, con tres registros,
pero no figura en la migración versionada de agosto: actualmente se crea desde el código.
Esto es deriva de esquema y debe corregirse mediante una migración aditiva e idempotente,
no modificando retrospectivamente la migración ya aplicada.

Para seguridad, el candidato separa credenciales, sesiones e intentos de acceso del perfil
del empleado. El ensayo no importa hashes ni tokens. En el corte se deben migrar los hashes
mediante un proceso privilegiado e invalidar las sesiones activas, obligando un nuevo inicio
de sesión. Los adjuntos binarios requieren copia por streaming, comparación de cantidad y
huella y claves foráneas recién después de comprobar que no existen huérfanos.

La auditoría conserva hoy un cuerpo JSON y su retención se aplica desde la aplicación. El
candidato tipa actor, acción, entidad y fecha, conserva el cuerpo original como evidencia y
requiere definir la retención en base de datos antes de activarlo.

Inventario reproducible de metadatos, sin lectura de valores:

```powershell
npm run inventory:database-schema
```
