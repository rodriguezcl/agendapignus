# Arquitectura de Agenda Pignus

## Objetivo

La aplicación sigue una Clean Architecture pragmática: las reglas operativas no
dependen de React, del navegador ni del transporte HTTP. Las dependencias apuntan
hacia el dominio y `App.jsx` funciona como raíz de composición durante la migración
incremental de las pantallas históricas.

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
│   └── services/presentation/      # Pantalla del catálogo de servicios
├── infrastructure/                 # Adaptadores externos
│   ├── browser/                    # Descargas del navegador
│   ├── http/                       # Transporte, timeouts y envíos técnicos
│   ├── media/                      # Procesamiento de imágenes
│   └── repositories/               # Estado, auditoría e importación de clientes
├── presentation/                   # Componentes visuales compartidos
│   └── components/forms/
├── components/ui/                  # Primitivas visuales existentes
├── App.jsx                         # Raíz de composición y pantallas por migrar
└── *.mjs                           # Puertos temporales de compatibilidad
```

El backend conserva su frontera independiente:

```text
api/                # Entradas HTTP/serverless
api/_lib/           # Casos de uso y persistencia del backend
supabase/            # Esquema y migraciones PostgreSQL
server.cjs           # Adaptador de ejecución local
```

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
- Los archivos raíz que reexportan módulos son compatibilidad temporal; no deben
  recibir lógica nueva.

## Flujo de ejemplo: catálogo de servicios

1. `ServiceTypes.jsx` recibe el catálogo visible desde la raíz de composición.
2. `buildServiceRecord` valida y crea la entidad con sus invariantes.
3. `serviceCatalogRepository` envía una operación HTTP de un solo registro.
4. `service-catalog-operation.cjs` controla concurrencia sobre ese registro y
   decide si una baja referenciada debe convertirse en desactivación.
5. El servidor normaliza las referencias relacionadas dentro de una transacción,
   incrementa la revisión y devuelve solamente el catálogo actualizado.
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

## Verificación

- `npm test`: reglas de negocio, API, seguridad y fronteras arquitectónicas.
- `npm run build`: integración real de imports, JSX y empaquetado de producción.
- `tests/clean-architecture.test.cjs`: impide que el dominio dependa de React o
  infraestructura y prueba el caso de uso extraído del catálogo.
