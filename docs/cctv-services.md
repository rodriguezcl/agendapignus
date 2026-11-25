# Servicios de CCTV

El módulo aparece debajo de **Abonados y clientes**. Usa la marca existente `cctvService === true`: no duplica cuentas ni modifica sus datos principales. Cada ficha se relaciona mediante `customerId`, por lo que un cambio de nombre o código PIG/CLI conserva el expediente.

## Uso

- **Datos generales:** cuenta, cliente, dirección, teléfonos, correo, contacto y requerimiento de acceso. Se mantienen desde Abonados y clientes. Incluye actividad con autor, fecha/hora y color por autor.
- **Novedades:** título, observación y un PDF opcional por entrada. Descarga directa, búsqueda por texto/nombre del archivo y filtro por fechas. Los registros nuevos aparecen primero.
- **Poda y mantenimiento:** observación y próxima revisión opcional. Conserva los valores anteriores, quién hizo cada cambio y cuándo. La fecha es una referencia; no crea servicios ni recordatorios automáticamente.
- **Planimetría:** PDF/JPG/PNG/WEBP o esquema con cámaras, grabadores, alarmas, barreras infrarrojas, cercos, líneas y texto. Permite mover, orientar, etiquetar, eliminar y deshacer. Un esquema guardado puede usarse como base de una nueva versión. Los originales se conservan; los esquemas se exportan como SVG. Es un croquis de referencia, no un plano CAD ni un cálculo de cobertura real.
- **Mejoras:** propuesta, detalle, prioridad y casilla realizada/pendiente. Las realizadas quedan tachadas, con responsable y fecha de realización. El listado de cuentas permite filtrar aquellas con mejoras pendientes.
- **Ficha técnica:** varios equipos por cuenta, categoría, tipo, marca, modelo, cantidad, ubicación y observaciones. Según el tipo muestra canales, discos/capacidad, tecnología, resolución de cámara, zonas, comunicación, batería, alcance/haces/pares de barrera infrarroja, perímetro e hilos de cerco. Conserva el inventario anterior y nuevo en el historial.

Límite por archivo: **3 MiB** (la interfaz indica 3 MB). Cada aporte admite un archivo. El servidor valida tamaño, MIME y firma del contenido, y normaliza el nombre del archivo. No se admiten SVG subidos: el SVG descargable se genera exclusivamente desde geometría validada y texto escapado. No registrar contraseñas ni claves de equipos en la ficha.

## Acceso

Administración y Supervisión CCTV pueden consultar y editar. Los técnicos pueden consultar y descargar sólo las cuentas de sus servicios asignados y visibles, respetando la agenda bloqueada por pendientes y las reservas sin confirmar. No pueden editar, aunque una configuración granular intente concederles edición. El acceso de un técnico también incluye sus servicios históricos que sus permisos permitan consultar.

Permisos: `cctv.view`, `cctv.edit` y `cctv.download`. Los roles personalizados necesitan una concesión explícita y conservan sus alcances de cuentas. Los roles existentes de supervisor/técnico reciben los permisos correspondientes cuando aún no tienen las nuevas claves; una denegación explícita se conserva. Los datos de contacto respetan `records.contact`.

Desmarcar CCTV oculta la ficha y revoca las descargas, sin borrar documentos. Reactivar la marca permite consultar el expediente conservado. Desactivar un colaborador revoca su acceso mediante las comprobaciones de sesión existentes y la política del módulo. Cambiar las asignaciones limita las cuentas visibles para los técnicos.

## Persistencia e integración

Rutas autenticadas:

- `GET /api/cctv`: listado autorizado, contadores y fecha de actualización; no carga el contenido de archivos.
- `GET /api/cctv?customerId=…`: ficha autorizada.
- `POST /api/cctv`: comando con `commandId`, `customerId`, `expectedVersion`, `action` y `payload`.
- `GET /api/cctv/attachments?customerId=…&attachmentId=…`: descarga autorizada para esa cuenta, sin caché y con disposición de adjunto.

Tablas separadas del estado de agenda: `pignus_cctv_dossiers`, `pignus_cctv_attachments` y `pignus_cctv_commands`. Los archivos se guardan como BLOB/BYTEA; los JSON sólo contienen referencias y metadatos. La migración `202611250001_cctv_services.sql` crea las tablas con RLS y revoca el acceso directo público, `anon` y `authenticated`. El almacén también garantiza el esquema en el servidor local y PostgreSQL.

Cada comando guarda ficha, adjunto y registro de idempotencia en una transacción. Un reintento idéntico no duplica aportes. Dos ediciones simultáneas de una cuenta se resuelven mediante versión y bloqueo; la interfaz conserva el borrador ante un conflicto y permite actualizar antes de reintentar. Cambiar de pestaña conserva los borradores independientes; salir del módulo o cerrar la pestaña advierte sobre cambios sin guardar.

## Verificación

Pruebas `tests/cctv-*.test.cjs`: SQLite, PostgreSQL/PGlite, HTTP real con sesiones, permisos y denegaciones, aislamiento de adjuntos, rollback, concurrencia/idempotencia, validación de equipos/planos, exportación segura, repositorio y renderizado de consulta/edición. Se complementan con las pruebas existentes de permisos, navegación, arquitectura y calidad UX.

La revisión visual local usa datos sintéticos: PDF, mantenimiento, mejoras, NVR, dibujo, persistencia al reabrir, conflicto entre sesiones, borradores, consulta técnica, pantallas móviles y tema oscuro. No requiere ni modifica datos productivos.
