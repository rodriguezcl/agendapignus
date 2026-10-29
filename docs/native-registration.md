# Formularios propios de alta

## Circuito

Al guardar una instalación de alarma nueva con ubicación Docta, Nobu Town o Residencial se genera un enlace único. Agenda muestra el enlace para copiarlo y enviarlo al cliente. Las instalaciones anteriores pueden generarlo desde su detalle; no se convierten automáticamente respuestas históricas de Google.

El cliente abre `/alta#token`, sin iniciar sesión. Completa los pasos, revisa sus datos y envía una sola respuesta. La operación guarda la respuesta cifrada y actualiza `form` y `formEmail` en el servicio y sus jornadas dentro de una transacción. No crea tickets ni envía correos por completar el formulario. El correo de confirmación conserva su disparador existente: la vinculación del PIG.

La bandeja muestra un aviso «Formulario de alta recibido». El usuario autorizado revisa la respuesta, carga los datos en SoftGuard y confirma esa gestión. Esta confirmación retira el aviso; no realiza una integración automática con SoftGuard. Mientras el aviso del formulario esté pendiente se suprime el aviso de reserva del mismo registro.

Reprogramar conserva el enlace y muestra la fecha vigente. Una instalación de varias jornadas comparte formulario. Cancelar todas las jornadas bloquea el enlace y retira el aviso. Las respuestas siguen disponibles en los detalles de Agenda, Historial y de la cuenta vinculada.

Para corregir una respuesta, el gestor indica el motivo y genera un nuevo enlace. El anterior deja de funcionar. Se conserva la respuesta previa, se precargan sólo los datos no secretos y se exige volver a aceptar las condiciones. El nuevo envío crea otra versión y otro aviso de revisión. No cambia el correo general del cliente ni sobrescribe importes comerciales de Agenda.

## Estructura y validación

Los campos y contratos provienen de los PDF Docta, Nobu y Residencial entregados el 28/10/2026. Los originales contienen datos privados y no se incluyen en el repositorio ni se publican. `shared/registration/schema.mjs` define las variantes; `contracts.json` contiene solamente las condiciones generales. Cada respuesta conserva el texto, versión y hash de las condiciones aceptadas. Cualquier cambio contractual requiere actualizar la versión en ambos archivos. Firma, aclaración, DNI, número de cuenta y fecha de instalación conservan la firma presencial indicada en los originales.

Residencial admite Visa crédito, Mastercard crédito y CBU bancario. Se valida en cliente y servidor el número y marca mediante Luhn, vencimiento, DNI/CUIT y ambos verificadores del CBU. Se rechaza el prefijo CVU `000`, alias y datos incompletos. Para CBU se pide titular, DNI o CUIT/CUIL y banco. No se solicita ni almacena CVV, CVC ni PIN.

Estas comprobaciones detectan errores de formato; no verifican titularidad, fondos, existencia de la cuenta ni si una tarjeta es efectivamente de crédito. No se conecta un procesador de pagos ni se realiza una adhesión bancaria automática.

Los campos personales, dirección y tarjeta exponen los atributos HTML `name` y `autocomplete` para usar datos guardados en el dispositivo. Titular, pago y contactos de emergencia usan secciones independientes. DNI/CUIT, CBU y palabras de monitoreo no se etiquetan como datos de tarjeta o credenciales de acceso. Antes de avanzar o retroceder se leen también los controles visibles para conservar autocompletados que no emitan eventos de React. Las sugerencias disponibles dependen del navegador, su configuración y los datos guardados por el cliente.

## Permisos y almacenamiento

- `registration.read`: consulta de respuestas, respetando los alcances de servicios y cuentas y el permiso de contacto.
- `registration.manage`: generación de enlaces, solicitud de correcciones y confirmación de carga en SoftGuard. Respeta además el alcance de escritura del servicio.
- `registration.sensitive` junto con `records.financial`: revelación explícita de datos protegidos. Por defecto se muestran enmascarados; la interfaz los vuelve a ocultar después de un minuto. Cada consulta queda registrada.
- `notifications.registration`: avisos de formularios pendientes de revisar.

Los administradores tienen acceso. Los roles granulares necesitan habilitar expresamente los nuevos permisos. Los roles técnicos no reciben acceso por defecto. Habilitar lectura no concede gestión ni revelación.

Las respuestas se cifran con AES-256-GCM y contexto vinculado al formulario y revisión. Se guardan en `pignus_registration_responses`; el enlace se guarda cifrado y se busca por SHA-256 en `pignus_registration_forms`. PostgreSQL activa RLS y revoca acceso directo público, `anon` y `authenticated`. La API autenticada aplica los permisos. El estado compartido y la auditoría general no contienen respuestas ni secretos. No se guardan borradores en localStorage o sessionStorage. Los endpoints responden `no-store`.

## Configuración y operación

La clave se obtiene de `PIGNUS_REGISTRATION_ENCRYPTION_KEY` (mínimo 32 bytes), con derivación HKDF separada. Si no existe utiliza `PIGNUS_SESSION_SECRET`. Configurar y respaldar una clave dedicada **antes de recibir respuestas** es lo recomendado. Cambiar o perder la clave utilizada impide descifrar respuestas y enlaces; cualquier rotación exige migración de cifrado y respaldo previo. No agregar ni reemplazar una clave después de recibir formularios sin esa migración.

Sin clave válida no se generan enlaces automáticamente y el alta manual devuelve un error de configuración. Las tablas se inicializan desde el servidor. El despliegue debe incluir `shared/registration/**` (configurado en Vercel). Los originales Google siguen disponibles para casos anteriores; la nueva ruta no importa sus respuestas.

## Verificación

`tests/native-registration.test.cjs` prueba SQLite y PostgreSQL/PGlite, cifrado, permisos, versiones, correcciones, cancelación y varias jornadas. El caso «Formulario nativo HTTP» en `tests/security.integration.test.cjs` prueba el servidor local, permisos, origen y envíos simultáneos. `scripts/verify-native-registration.cjs` recorre los tres formularios con datos ficticios y API interceptada a 360, 390 y 1280 px. No envía datos a terceros.
## Reservas de ventas y confirmación de la visita

El módulo **Reservas de ventas** tiene dos permisos separados: `sales.view` (ver reservas propias) y `sales.reserve` (crear reservas). Administración puede consultar todas. El vendedor no necesita acceso al padrón, a la agenda completa ni a los datos financieros del formulario. Habilitar estos permisos en el rol correspondiente desde Configuración; no se modifican los roles existentes automáticamente.

Ventas carga nombre, teléfono, tipo de formulario, dirección, duración y punto confirmado en el mapa. Consulta equipos/horarios y crea una reserva **A confirmar**, visible en Agenda semanal, que ocupa el horario y permanece oculta al técnico. Se genera en la misma transacción su enlace único. La reserva conserva el vendedor y la ubicación seleccionada; no se confirma desde el módulo de ventas. Coordinación puede ajustar o confirmar desde las acciones habituales de la agenda.

El cálculo usa distancia geográfica en línea recta, sin API de rutas ni tráfico. Valores iniciales: **25 km/h y 15 minutos adicionales por traslado**, configurables mediante `PIGNUS_SALES_ESTIMATE_KMH` (5–100) y `PIGNUS_SALES_BUFFER_MINUTES` (0–120). Comprueba los trabajos anterior y siguiente de cada técnico, incluso si trabaja en equipos diferentes, respeta horarios, almuerzo, feriados, guardias adelantadas y reservas a confirmar. Si una visita contigua no tiene coordenadas utilizables, indica revisión pendiente y no inventa una distancia. La primera visita no supone una ubicación de salida conocida. Los resultados son estimativos y requieren revisión de Coordinación.

La API `/api/sales/bookings` recalcula disponibilidad al guardar bajo el bloqueo de revisión del estado (PostgreSQL) o transacción serializada (SQLite). La clave de idempotencia por usuario evita duplicados por doble clic/reintento. Nunca acepta equipos, estados, autorizaciones o estimaciones enviados por el navegador como datos definitivos. El selector permite fechas hasta 180 días desde hoy.

El cliente ve únicamente su tipo de formulario y la visita **pendiente de confirmación**. Se precargan nombre y teléfono de la reserva, y la dirección en el formulario residencial. El correo de **confirmación de visita** se encola sólo cuando coinciden visita confirmada y formulario completo con correo válido, independientemente del orden. Usa la cola SMTP existente, deduplicación y recuperación de entregas inciertas; requiere el canal de correo activo en modo operativo. La confirmación de alta al vincular PIG y la invitación posterior a la instalación siguen siendo eventos distintos. Vincular un PIG antes de confirmar no promete al cliente una visita definitiva.

Validación: `node --test tests/sales-booking.test.cjs` cubre SQLite, PostgreSQL, aislamiento por vendedor, duplicados, ocupación compartida, traslados, almuerzo, feriados y correo único. `scripts/verify-sales-booking.cjs` verifica móvil/escritorio y claro/oscuro con API interceptada y datos ficticios. No genera reservas ni correos reales.

## Bandeja de Formularios

El menú **Clientes y cobranzas → Formularios** requiere `forms.view` y sus dependencias de consulta (`registration.read`, contacto y acceso al servicio/cuenta). Reúne enlaces por completar, respuestas recibidas pendientes de cargar en SoftGuard, correcciones solicitadas, formularios gestionados y cancelados. La búsqueda por cliente/cuenta, tipo y estado y la paginación de 20 registros se aplican en servidor después del filtro de alcance. Los contadores sólo incluyen registros autorizados y respetan búsqueda/tipo. La bandeja no descifra respuestas ni devuelve enlaces privados: se consultan al abrir el detalle con los permisos existentes. “Ver servicio” abre su instalación en Agenda semanal si el usuario tiene acceso.

## Catálogos de localidades, barrios y bancos

El formulario residencial ofrece primero localidad de Córdoba y después barrios correspondientes. `shared/registration/catalog-data.mjs` contiene una copia pública versionada: **502 localidades, 806 nombres de barrios para 13 localidades y 60 bancos** en la consulta del 28/10/2026. El navegador y el servidor comparten el mismo catálogo y validan las opciones; no dependen de una API externa durante el llenado. Cambiar la ciudad limpia el barrio anterior. No se envían direcciones, CBU ni datos personales a proveedores externos.

Fuentes y atribución:

- [Georef, localidades de Córdoba](https://apis.datos.gob.ar/georef/api/localidades?provincia=14&max=5000&campos=id,nombre,departamento), servicio público del Estado argentino. Se unifican componentes y agregados con nombre/departamento idénticos; homónimos de distintos departamentos conservan su identificación.
- [Municipalidad de Córdoba, Catastro: barrios, edición 2023](https://gobiernoabierto.cordoba.gob.ar/data/datos-abiertos/categoria/geografia-y-mapas/barrios-de-la-ciudad/118), recurso KMZ 18854, licencia **CC-BY-SA-AR (CBA)**. El subconjunto derivado de nombres de Córdoba conserva esa licencia. Se extraen los nombres del recurso, se normalizan espacios/mayúsculas y se eliminan duplicados. La API municipal de barrios devolvía HTTP 500 al preparar esta versión; se utilizó la descarga oficial.
- [IDECOR, servicios públicos WFS](https://www.idecor.gob.ar/web-service-y-apis/): Anisacate, Colonia Caroya, Corralito, Cosquín, Hernando, La Falda, Morteros, Salsipuedes, Unquillo, Villa Allende, Villa Giardino y Villa María. Cada lista conserva su URL WFS de origen en el catálogo. No se usan abreviaturas sin interpretación verificable de otras capas.
- [BCRA, entidades financieras](https://www.bcra.gob.ar/entidades-financieras/), API utilizada por su sitio oficial; edición informada **julio de 2026**. Se conservan denominaciones y códigos de banco publicados, incluidas denominaciones abreviadas por la fuente.

**Cobertura de barrios parcial:** no se encontró una fuente única con todos los barrios de cada ciudad de la provincia. El formulario lo informa y ofrece “Mi barrio no figura / zona rural” con un campo adicional obligatorio. Es una excepción explícita, guardada y destacada como pendiente de revisión en el detalle del formulario; no se inventan barrios ni se bloquea al cliente. La ausencia de un barrio en el catálogo no implica que no exista. Los datos anteriores desconocidos se precargan como esta excepción al solicitar una corrección.

El banco se sugiere localmente por los primeros tres dígitos del CBU; el usuario puede seleccionarlo y el servidor verifica la coincidencia de código. CVU y bancos fuera del catálogo no se aceptan. Esto sólo comprueba formato/coherencia: no confirma titularidad, existencia de la cuenta ni autorización de débito. Si una entidad cambia de nombre/código debe actualizarse el catálogo; nunca se envía el número de cuenta al BCRA.

Actualización: `python scripts/update-registration-catalogs.py` descarga fuentes públicas, valida las cantidades y asociaciones y reemplaza el archivo sólo si todas las fuentes responden correctamente. Revisar el diff y desplegar la actualización; no hay una tarea automática instalada. Una falla deja intacta la última copia. La actualización de nombres no modifica respuestas históricas.

Pruebas: `tests/forms-inbox.test.cjs`, `tests/registration-catalogs.test.cjs` y los casos SQLite/PostgreSQL de `tests/native-registration.test.cjs`. Verificación visual: `scripts/verify-forms-inbox.cjs` y `scripts/verify-native-registration.cjs`, con datos ficticios y todas las solicitudes interceptadas.

## Transición desde Google

La bandeja incluye también las instalaciones anteriores con formulario completo y correo, y los tickets reconocidos como avisos de Google. Se identifican como **Google / registro anterior**. No se importan respuestas ni adjuntos de Google y consultar la bandeja no modifica servicios, tickets ni envía correos.

Se reúnen las jornadas del mismo servicio. Los tickets se agrupan con la instalación cuando tienen una vinculación explícita o existe una única coincidencia de correo y tipo de formulario en toda la agenda. La coincidencia sólo organiza la pantalla: el usuario debe verificar y confirmar la vinculación mediante la operación de tickets existente. Los casos ambiguos permanecen separados. Si una instalación ya tiene formulario propio, su respuesta no se sustituye por datos de Google; cualquier ticket anterior sin gestión sigue disponible como referencia separada.

El detalle permite vincular el formulario sin salir de la bandeja, abrir la instalación para vincular el PIG y consultar el historial del ticket. Los registros y tickets conservan sus permisos y alcances originales; disponer de `forms.view` no habilita acceso adicional a tickets ni a respuestas protegidas.

Los avisos de formularios abren su caso en **Formularios**, incluso si los filtros actuales lo excluyen. Mientras existe un aviso unificado autorizado, la campana y Web Push omiten los avisos de reserva y tickets que éste cubre. Sin el permiso de formularios se conservan los avisos y destinos anteriores. El caso sigue pendiente si falta vincular el PIG, incluso después de resolver el ticket de Google o confirmar la carga de un formulario propio en SoftGuard. Los formularios propios cancelados no generan avisos de alta.

`tests/registration-transition.test.cjs` verifica agrupación, ambigüedad, permisos, cancelación, continuidad hasta vincular PIG y ausencia de escrituras/correos en las consultas, tanto en SQLite como en PostgreSQL. La prueba visual de bandeja incluye Google y apertura directa, con datos ficticios.
