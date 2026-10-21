# Arquitectura de Agenda Pignus

## Objetivo

La aplicación sigue una Clean Architecture pragmática: las reglas operativas no
dependen de React, del navegador ni del transporte HTTP. Las dependencias apuntan
hacia el dominio y `App.jsx` funciona como raíz de composición: sesión, estado
compartido, coordinación de guardados y navegación. Las pantallas se cargan por
módulo con `React.lazy` y límites de `Suspense` que conservan la navegación.

## Estructura

```text
src/
├── domain/                         # Reglas puras, entidades y políticas
│   ├── access/                     # Roles y permisos
│   ├── agenda/                     # Horarios, guardias, feriados y planificación
│   ├── configuration/              # Historial de configuraciones
│   ├── customers/                  # Importación y reconciliación de clientes
│   ├── dashboard/                  # Métricas operativas
│   ├── history/                    # Orden del historial
│   ├── services/                   # Entidad y catálogo de servicios
│   ├── shared/                     # Normalización sin dependencias externas
│   ├── technicians/                # Consultas del portal técnico
│   └── vehicles/                   # Controles y asignaciones vehiculares
├── features/                       # Módulos verticales orientados a casos de uso
│   ├── agenda/                    # Planificación diaria/semanal y modelos de agenda
│   ├── auth/                      # Ingreso y ciclo de sesión
│   ├── customers/                 # Cuentas, ficha e historial del cliente
│   ├── dashboard/                 # Indicadores y reportes
│   ├── employees/                 # Empleados y formulario de edición
│   ├── history/                   # Consulta, gestión y detalle del historial
│   ├── services/                  # Catálogo y campos de servicios
│   ├── settings/                  # Configuración
│   ├── state/application/         # Comandos, borradores y concurrencia
│   ├── technicians/               # Portal técnico
│   └── vehicles/                  # Vehículos
├── infrastructure/                 # Adaptadores externos
│   ├── browser/                    # Descargas del navegador
│   ├── http/                       # Transporte, timeouts y envíos técnicos
│   ├── media/                      # Procesamiento de imágenes
│   └── repositories/               # Estado, auditoría e importación de clientes
├── presentation/                   # Componentes visuales compartidos
│   └── components/forms/
├── components/ui/                  # Primitivas visuales existentes
├── App.jsx                         # Composición, sesión y estado compartido
└── *.mjs                           # Puertos temporales de compatibilidad
```

El backend conserva su frontera independiente:

```text
api/                # Entradas HTTP/serverless
api/_lib/           # Casos de uso y persistencia del backend
supabase/            # Esquema y migraciones PostgreSQL
server.cjs           # Adaptador de desarrollo y pruebas de integración
```

## Comprobantes de cobranzas

`src/domain/collections/collections.mjs` exige respaldo verificado para confirmar
pagos distintos de efectivo. La evidencia se prepara en el servidor con
`api/_lib/collection-receipts.cjs`; las banderas o metadatos enviados por el
navegador no acreditan que exista un archivo.

`collection-receipt-store.cjs` guarda los bytes en la tabla de adjuntos con
`scope = collection`, vinculados al registro dueño de la cobranza. La inserción
del archivo, el cambio del pago y su auditoría comparten una transacción. En
SQLite no se ejecutan operaciones asíncronas dentro de `BEGIN IMMEDIATE`.
El estado operativo contiene sólo metadatos y conserva las versiones previas;
los archivos no pueden eliminarse ni sobrescribirse desde los endpoints comunes
de adjuntos técnicos.

La descarga exige acceso a Cobranzas, datos financieros y alcance sobre el dueño
y la jornada efectiva. Las versiones anteriores requieren además trazabilidad.
La carga o sustitución utiliza el permiso para confirmar pagos. Adjuntar respaldo
a un pago histórico conserva su confirmación original; cambiar su medio por otro
distinto de efectivo exige un archivo nuevo.

## Regla de dependencias

```text
presentation/features ──> domain
          │                 ▲
          └──> infrastructure (adaptadores/repositorios)

domain ──X──> React, DOM, fetch, infrastructure
```

- `domain` sólo contiene JavaScript puro y puede ejecutarse con Node.
- `features` coordina estado de interfaz y casos de uso de un módulo concreto.
- `presentation` contiene componentes reutilizables sin decisiones de negocio.
- `infrastructure` encapsula HTTP, navegador, archivos y servicios externos.
- Los repositorios traducen respuestas HTTP a datos o errores con `status`.
- Las pantallas no importan `App.jsx`. Los helpers compartidos se importan desde
  módulos independientes de dominio, aplicación o presentación.
- Los estilos específicos se importan desde su pantalla para acompañar la carga
  diferida. Las capas globales de compatibilidad conservan su orden de cascada.
- Los archivos raíz que reexportan módulos son compatibilidad temporal; no deben
  recibir lógica nueva.

## Flujo de ejemplo: catálogo de servicios

1. `ServiceTypes.jsx` recibe el catálogo visible desde la raíz de composición.
2. `buildServiceRecord` valida y crea la entidad con sus invariantes.
3. `serviceCatalogRepository` envía una operación HTTP de un solo registro.
4. `service-catalog-operation.cjs` controla concurrencia sobre ese registro y
   decide si una baja referenciada debe convertirse en desactivación.
5. El servidor prepara y valida las referencias relacionadas antes de tomar el
   bloqueo de revisión. Después revalida la base y confirma los cambios dentro
   de una transacción; si la revisión cambió, libera la transacción y prepara
   nuevamente. Un conflicto sobre el mismo registro sigue devolviendo `409`.
6. Durante la transición, la interfaz recarga el estado remoto para reflejar las
   referencias normalizadas; esa lectura global se dividirá en una etapa posterior.

## Estrategia de migración

La migración es incremental para conservar el comportamiento productivo:

1. Extraer reglas puras a `domain` y cubrirlas con pruebas.
2. Encapsular cada endpoint en un repositorio de `infrastructure`. El catálogo de
   servicios ya usa `POST/PUT/PATCH/DELETE /api/services` en lugar del `PUT`
   global para sus escrituras. El ABM de vehículos usa de la misma forma
   `POST/PUT/DELETE /api/vehicles`, mientras los seguros conservan su endpoint
   documental independiente.
3. Mover una pantalla completa por vez a `features/<módulo>/presentation`.
4. Eliminar su versión histórica de `App.jsx` cuando no existan importadores.
5. Retirar los puertos raíz de compatibilidad al actualizar consumidores externos.

Todo módulo nuevo debe ingresar directamente en esta estructura; no debe agregar
reglas de negocio ni llamadas HTTP a `App.jsx`.

## Persistencia y reglas compartidas

- PostgreSQL guarda diferencias por registro en los catálogos y el historial.
  `customerId` conserva la identidad cuando cambia la cuenta; los intercambios
  de cuentas o correos se resuelven dentro de la misma transacción.
- SQLite actualiza filas con UPSERT y conserva su `rowid`; los registros que no
  cambiaron no se reescriben.
- `api/_lib/access-policy.cjs`, `service-completion.cjs`,
  `employee-credentials.cjs` y `report-formatting.cjs` comparten políticas puras
  entre el servidor local y Vercel. El transporte y las consultas siguen en sus
  respectivos adaptadores.
- `prepared-catalog-write.cjs` coordina preparación, revalidación y confirmación
  de servicios y vehículos. La caché sólo recuerda estados ya confirmados.
- `export-state.cjs` consulta el catálogo y el historial completado del período,
  respetando el selector de almacenamiento y la restricción por técnico.
- La compatibilidad entre el modelo legado y el normalizado sigue activa. No se
  elimina un modelo ni una regla por su antigüedad: el retiro requiere verificar
  consumidores, datos existentes y reversión.

## Verificación

- `npm test`: reglas de negocio, API, seguridad y fronteras arquitectónicas.
- `npm run build`: integración real de imports, JSX y empaquetado de producción.
- `npm run analyze:build`: tamaño de la carga inicial, incluyendo sus dependencias
  compartidas y CSS, a partir del manifiesto generado por Vite.
- `tests/clean-architecture.test.cjs`: impide que el dominio dependa de React o
  infraestructura y prueba el caso de uso extraído del catálogo.
- `tests/refactor-boundaries.test.cjs`: impide nuevas implementaciones inaccesibles
  después de un retorno y dependencias desde las pantallas hacia `App.jsx`.
- El Quality Gate UX inspecciona el grafo alcanzable desde `main.jsx`, incluidas
  las pantallas diferidas; no depende de que su código permanezca en `App.jsx`.
