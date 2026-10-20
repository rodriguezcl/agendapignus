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

## Mejoras de clics rápidos de agenda, 20/10/2026

«Listo» y la selección de técnicos muestran la intención local antes de preparar
la solicitud. La indicación de guardado sigue activa hasta recibir y aplicar la
confirmación; un rechazo restaura los datos confirmados y muestra el error. Las
selecciones consecutivas del mismo equipo se agrupan: una solicitud en curso y,
si hace falta, otra con la última selección. Equipos independientes pueden guardar
en paralelo. La navegación y el cierre de página protegen las selecciones pendientes.

Estas acciones construyen operaciones sobre el registro o equipo afectado, sin
serializar todos los catálogos ni adjuntar borradores ajenos. En el servidor se
reconoce un conjunto estricto de modificaciones; las operaciones estructurales,
mixtas o que requieren reparación histórica conservan el circuito completo. El
circuito acotado utiliza las políticas existentes de permisos, conflictos,
preparación, asignación, servicios terminados y superposición de horarios.

Pruebas con los componentes reales en escritorio y móvil, datos sintéticos y
guardados demorados entre 1000 y 1500 ms: respuesta visual de 18–36 ms. Cubren
reversiones, clics consecutivos y confirmaciones fuera de orden. La preparación de
la operación «listo», con 12000 clientes y 3000 servicios sintéticos, pasó de una
mediana de 96,9 ms a 0,08 ms. Son mediciones locales; no representan la confirmación
del guardado ni latencias de producción.

La integración con `App` real y 1000 registros históricos sintéticos midió
21–38 ms entre clic y respuesta visual, en 1440 y 390 px, sin serializar snapshots
completos antes de mostrarla. Los comandos de preparación y miembros utilizaron
el circuito acotado real; se probaron respuestas delta/completas, rechazos y colas.
La hidratación posterior a la confirmación todavía serializa el estado; en ese
fixture cada serialización tomó como máximo 5–6 ms.

El handler real, con PostgreSQL embebido aislado y un fixture de 3000 clientes y
600 servicios, pasó de 271–295 ms a 171–181 ms en guardados calientes de «listo».
La validación pasó de 63–70 ms a menos de 1 ms. La asignación de técnicos pasó de
277–291 ms a 179–224 ms. En esta comparación ambos handlers usan los mismos helpers
de persistencia actuales: aísla la mejora del circuito acotado y no incluye red.
Las consultas bajaron de 15 a 12 para «listo» y de 23 a 20 para asignaciones. La
auditoría mantiene ambos modelos y su retención con dos consultas cuando el
esquema normalizado ya está preparado.

```text
node scripts/benchmark-planning-clicks.cjs ba57298
node scripts/verify-weekly-interactions.cjs
node scripts/verify-quick-agenda-app.cjs
```

Los dos scripts de navegador requieren Playwright y Microsoft Edge. Interceptan
las solicitudes y usan datos sintéticos; no modifican la aplicación publicada.

La persistencia normalizada prepara también las diferencias entre filas, las bajas,
los cambios de posiciones y las transferencias de identidad antes de adquirir el
bloqueo de revisión. Las filas iguales se comparan directamente; se conserva la
comparación canónica como alternativa y no cambia el algoritmo de fingerprints.
Se mantienen el orden de dependencias, la comprobación de revisión y fingerprint,
las transacciones y la escritura de compatibilidad.

Un snapshot leído del modelo normalizado registra por separado las credenciales
observadas. Cuando una operación conserva el mismo array de empleados y los mismos
valores, no necesita consultarlos otra vez durante la escritura. Una modificación
de credenciales, incluso en el mismo objeto, conserva la sincronización completa.
La lectura inicial y los aciertos de la caché siguen leyendo credenciales frescas;
un clic de agenda no sobrescribe una contraseña cambiada concurrentemente.

Medición local de CPU con 848 registros históricos y 1174 clientes, obtenidos mediante
una transacción `READ ONLY`. La modificación de preparación de un servicio y todas
las consultas de escritura se simulan exclusivamente en memoria. Se alternaron seis
ejecuciones del repositorio anterior (`ba57298`) y del actual, con el mismo constructor
de proyecciones para ambos. No se escribieron datos ni se imprimieron registros.

| Medida | Antes | Después |
| --- | ---: | ---: |
| Mediana de CPU, preparación y sincronización simulada | 581 ms | 366 ms |
| CPU de sincronización que quedaba dentro del bloqueo | 281–310 ms | 0–1 ms |
| Consultas simuladas de esta sincronización normalizada | 4 | 3 |

La reducción de CPU de esta etapa es aproximadamente del 37%. No mide la latencia
del guardado en producción, las consultas de compatibilidad/auditoría, la red ni el
renderizado. La prueba de una caché adicional de proyecciones no aportó una mejora
frente a la comparación directa y fue descartada. La lectura con caché del snapshot
completo, medida por separado desde el entorno local, tomó aproximadamente 0,97–1,25 s;
el primer acceso varió ampliamente con el establecimiento de la conexión.

Comando reproducible desde una copia con acceso de lectura a la base:

```text
node --env-file-if-exists=.env.local scripts/benchmark-normalized-projection-readonly.cjs ba57298
```

El script sólo informa cantidades, tiempos y consultas simuladas. Las pruebas
aisladas con PGlite verifican reordenamientos, transferencias de identidad, altas,
bajas, conflictos, rollback y conservación de contraseñas concurrentes.

Validación final de esta corrección: 962 pruebas aprobadas en la copia aislada
de publicación, build de producción y controles UX aprobados. El navegador
verificó ese build en 1440 y 390 px, además de las pruebas de interacción con
guardados demorados. Se excluyeron de la publicación los cambios locales ajenos
a esta corrección.
