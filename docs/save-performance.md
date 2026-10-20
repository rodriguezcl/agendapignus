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

## Refactorización del 20/10/2026

Se separaron las pantallas de la raíz de composición, se eliminaron implementaciones
inaccesibles después de retornos y se compartieron políticas puras entre el servidor
local y Vercel. `App.jsx` pasó de 6585 a 1533 líneas. Las pantallas, sus helpers y sus
estilos específicos ahora viven en módulos por funcionalidad.

Mediciones locales sobre compilaciones de producción, antes y después:

| Medida | Antes | Después |
| --- | ---: | ---: |
| JavaScript del punto de entrada, gzip | 251,30 kB | 109,64 kB |
| CSS del punto de entrada, gzip | 61,03 kB | 52,29 kB |
| Serializaciones completas del estado al alternar el menú diez veces | 10 | 0 |
| Caracteres serializados por esas interacciones, con el mismo fixture | 151890 | 0 |

Los tamaños usan kB decimales. El análisis recorre el punto de entrada y sus
dependencias estáticas, incluyendo CSS compartido. No suma las pantallas diferidas
que se solicitan al navegar o al mostrar la vista inicial de una sesión. La reducción
del JavaScript inicial es aproximadamente del 56%; no representa una medición de
latencia de la aplicación ni de transferencia total durante una sesión.
Las hojas históricas de agenda con selectores usados por varias pantallas mantienen
su carga global y su orden original. Sólo se difieren los estilos propios de una vista.

Cambios que evitan trabajo repetido:

- El snapshot compartido se recalcula sólo cuando cambia alguno de sus datos.
- El historial reutiliza índices de búsqueda; la vista de consulta muestra hasta
  50 registros por página, manteniendo filtros y totales.
- PostgreSQL y SQLite actualizan los registros que cambiaron, conservando la
  identidad de clientes, las credenciales y las referencias a documentos.
- La inicialización del esquema se comparte por conexión y sólo se recuerda tras
  confirmar su transacción. Un error permite reintentar.
- Las exportaciones consultan el historial del período solicitado y el catálogo
  necesario, sin cargar toda la agenda.

Para reproducir las mediciones del empaquetado:

```text
npm run build
npm run analyze:build
```

La verificación visual usa datos sintéticos y solicitudes interceptadas: escritorio
de 1440 px y móvil de 390 px, temas claro y oscuro. El script
`scripts/verify-admin-chrome.cjs`, con `CHROME_PRODUCTION=1`, prueba los archivos reales
de `dist`, la navegación diferida y el trabajo de serialización del menú.
`scripts/verify-admin-theme.cjs` comprueba las vistas y sus controles; ambos requieren
Playwright y un navegador Chromium local. Los resultados locales quedan en
`tmp/visual-qa`, fuera del código versionado.

La suite completa de la versión aislada para publicación pasó 939 pruebas; el Quality Gate UX pasó sus 21
controles (100/100). La revisión visual pasó 120 comprobaciones, además de la
navegación y los formularios del build real en ambos tamaños de pantalla.
Las pruebas de persistencia usan SQLite temporal y PostgreSQL
embebido aislado, incluyendo conflictos de revisión, intercambio de identificadores,
conservación de credenciales/documentos y fallos de confirmación del esquema.

Se conserva la compatibilidad de almacenamiento legado/normalizado. Las mediciones
de latencia p50/p95 de producción siguen correspondiendo a una verificación posterior
al despliegue.
