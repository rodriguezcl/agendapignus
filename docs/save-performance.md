# Rendimiento y concurrencia del guardado

## Implementación

- Auditoría por lotes; se mantienen retención, reintentos y transacción atómica.
- Preparación y validación antes de tomar el bloqueo de revisión. Si otra sesión confirma mientras tanto, la transacción se revierte y vuelve a prepararse fuera del bloqueo (máximo cinco intentos). Los conflictos reales del mismo registro NO se reintentan como sobrescrituras.
- Proyección normalizada preparada antes del bloqueo; escritura incremental de filas existente conservada. No se omiten validaciones de técnicos, horarios, identidad ni jornadas.
- Lectura consolidada del selector y snapshot normalizado para evitar revisiones mezcladas.
- Caché de una instantánea por instancia del servidor, validada contra ambas revisiones y el modelo activo en CADA uso. No almacena contraseñas ni hashes; las credenciales se consultan de nuevo. Invalida ante cambios de otra sesión, otro servidor o cambio de modelo.
- Respuesta delta-v1: registros modificados y planes afectados. Solo se usa si coincide exactamente la revisión de origen. Si no coincide, se devuelve el estado completo autorizado para el usuario.
- Guardados independientes de servicios en paralelo en la misma sesión. Exclusión por identificadores compartidos; cambios estructurales/configuraciones mantienen exclusión conservadora.
- Respuestas fuera de orden no hacen retroceder la pantalla. Se aplica la revisión más reciente al terminar el grupo de guardados, conservando ediciones posteriores. Conflictos con un borrador suspenden el autoguardado y requieren revisión explícita.
- Aviso discreto no bloqueante. Los formularios conservan sus protecciones de guardado; cierre de sesión se deshabilita y abandonar la página advierte mientras haya guardados pendientes. Una respuesta de una sesión invalidada no se aplica.

## Límites deliberados

No se promete persistencia instantánea ni éxito anticipado. Se mantienen una sección atómica final compartida y las transacciones multi-jornada: el modelo legado guarda la agenda completa y el normalizado mantiene un fingerprint global. La lectura, normalización y validación ya no mantienen ese bloqueo, pero las escrituras físicas finales todavía se serializan. El primer acceso de una instancia fría o una revisión cambiada requiere una lectura completa. No se hizo una migración destructiva ni se desactivó la réplica de compatibilidad.

## Medición

Server-Timing y logs state_write_timing: read_state, validation, prepare_audit, prepare_projection, lock_wait, persist, audit, commit, response_projection y total. Solo nombres de etapas y duraciones; nunca datos operativos. Los reintentos agregan etapas sucesivas. Total no incluye autenticación previa, transferencia HTTP ni renderizado.

El script scripts/benchmark-save-readonly.cjs utiliza transacciones PostgreSQL explícitamente de solo lectura. No guarda ni imprime servicios/clientes. Diagnóstico del 22/09/2026 desde el entorno local: lectura inicial caliente ~3,6–4 s; lectura con caché verificada ~1,37–1,43 s. La preparación tomó ~0,3–0,4 s. La primera conexión fría sigue siendo más lenta. Estas cifras NO son latencias del guardado completo desde Vercel y varían con red/carga.

Pruebas: lote de 120 auditorías pasa de 244 consultas a 6 (4 con preparación ya comprobada); con un evento sin metadatos preparados no cambia el número. Fixture de 1000 servicios: respuesta de un registro menor al 1% del snapshot completo. Handler real probado contra PostgreSQL aislado: persistencia consistente en ambos modelos, respuesta parcial, repetición idempotente, edición independiente desde base desactualizada y rechazo de sobrescritura del mismo servicio. Pruebas adicionales cubren respuestas fuera de orden, cambio de sesión, caché y conservación de borradores.

Después del despliegue comparar p50/p95 reales por operación, con una sesión y varias sesiones. No usar servicios reales para generar escrituras de prueba sin una instrucción específica.
