AGENDA TÉCNICA PIGNUS
=====================

Plataforma web para coordinar la operación técnica de Pignus: planificación,
ejecución de servicios, gestión de abonados y clientes, cobranzas y seguimiento.
La información se comparte entre usuarios según sus permisos y alcance.

Aplicación publicada: https://agendapignus.vercel.app
Responsable del proyecto: Cristian Leonardo Rodriguez.
Revisión documental: 21 de octubre de 2026.

FUNCIONALIDADES
---------------

- Resumen general: proyección neta de abonados, composición del período,
  evolución anual, cobranzas y consultas con exportaciones específicas.
- Agenda semanal: equipos, colaboradores, disponibilidad horaria, preparación
  de servicios, reservas, confirmación, reprogramación y trabajos de varias
  jornadas. La disponibilidad considera la ocupación de los integrantes en
  otros equipos del mismo día, el almuerzo y las reglas de jornada y guardia.
- Portal técnico: servicios asignados, inicio, adelanto, informes de avance,
  finalización, cancelación y adjuntos, según las capacidades habilitadas.
- Historial: consulta y trazabilidad de los servicios y sus informes técnicos.
- Abonados y clientes: importación, identificación, datos de contacto,
  ubicaciones e historial relacionado.
- Cobranzas: segmentos actuales/pasados y futuros, correcciones, confirmación
  de pagos y comprobantes obligatorios para medios distintos de efectivo.
- Mapa: vistas independientes de mapa de calor, puntos por abonado y zonas rojas.
- Recursos: Colaboradores, tipos de servicio y Flota, con asignaciones,
  controles vehiculares y guardias.
- Configuración: roles y permisos por función, dependencias entre capacidades,
  vista previa por rol y selección de notificaciones.
- Auditoría y Centro de ayuda: seguimiento de acciones y orientación de uso.

La planificación visible se concentra en Agenda semanal. La implementación
de Agenda del día se conserva internamente por compatibilidad.

Los recordatorios de baja en SoftGuard requieren que una persona realice la
gestión externa y registre su resolución. No ejecutan una baja automática.

ESTRUCTURA
----------

- `src/App.jsx`: composición de la aplicación, sesión y coordinación compartida.
- `src/domain/`: reglas de negocio y políticas independientes de la interfaz.
- `src/features/`: módulos de negocio y sus casos de uso.
- `src/infrastructure/`: adaptadores HTTP, repositorios, archivos y navegador.
- `src/presentation/`: componentes y comportamiento visual compartidos.
- `src/components/ui/`: componentes visuales reutilizables.
- `api/index.js`: entrada HTTP de producción en Vercel.
- `api/_lib/`: autorización, casos de uso y persistencia del servidor.
- `server.cjs`: adaptador de desarrollo y pruebas de integración.
- `supabase/`: migraciones reproducibles del esquema PostgreSQL.
- `scripts/`: herramientas de verificación, diagnóstico y mantenimiento.
- `tests/`: pruebas de reglas operativas, permisos, persistencia e integración.
- `public/`: imágenes y recursos estáticos.
- `docs/`: arquitectura, concurrencia, despliegue y decisiones técnicas.

PLATAFORMA Y PERSISTENCIA
------------------------

La interfaz utiliza React y Vite. Vercel publica el cliente y ejecuta la API;
PostgreSQL en Supabase conserva los datos productivos. El navegador se comunica
con la API y no recibe credenciales de conexión a la base de datos.

El proyecto mantiene un adaptador SQLite para desarrollo y pruebas. Esa base no
representa por sí sola el estado de producción ni sustituye su respaldo.
La persistencia incluye un modelo normalizado y mecanismos de compatibilidad;
antes de una migración o recuperación debe comprobarse el modelo activo.

Los cambios concurrentes utilizan revisiones y validaciones de disponibilidad.
Los adjuntos y comprobantes requieren controles de acceso y deben incluirse
en las verificaciones de integridad y recuperación.

No versionar credenciales, archivos .env, bases operativas ni datos de clientes.
Los respaldos, migraciones y restauraciones deben planificarse para el entorno
correspondiente; una migración inicial no es un paso rutinario de despliegue.

MANTENIMIENTO Y VALIDACIÓN
--------------------------

La línea base declara Node.js 22.x en package.json. Utilizar `npm ci` para
instalar las dependencias del lockfile de forma reproducible.

- `npm test`: suite automatizada.
- `npm run test:ux`: controles de experiencia e interfaz.
- `npm run test:concurrency`: pruebas de concurrencia y seguridad.
- `npm run build`: compilación de producción.
- `npm run analyze:build`: análisis de la carga del cliente compilado.

Las pantallas se cargan por módulo. Mantener las reglas de negocio fuera de
App.jsx y verificar permisos, conflictos de edición y persistencia al cambiar
flujos operativos. Las actualizaciones visuales optimistas deben recuperar el
estado correcto si el servidor rechaza una escritura.

Antes de publicar, ejecutar las verificaciones pertinentes y revisar el alcance
del commit. Después del despliegue, comprobar la versión servida, el acceso
autenticado y los flujos afectados. No usar datos productivos como fixtures.

DOCUMENTACIÓN TÉCNICA
---------------------

- `docs/ARQUITECTURA.md`: organización del código y límites entre capas.
- `docs/CONCURRENCIA.md`: revisiones, escrituras compartidas y conflictos.
- `docs/save-performance.md`: guardado y respuesta de acciones frecuentes.
- `docs/service-journeys.md`: servicios con varias jornadas.
- `docs/DESPLIEGUE-VERCEL-SUPABASE.md`: infraestructura y verificaciones de
  publicación; distingue preparación inicial y migración de datos.
- `docs/database-normalization.md`: antecedentes del modelo normalizado.
- `docs/database-cutover-plan.md`: controles para cambios de almacenamiento.
- `docs/UX-UI-CONSTITUTION.md`: criterios de experiencia de usuario.

Leer los documentos históricos junto con su fecha y la versión del código:
un ensayo o certificado anterior no acredita el estado actual de producción.
