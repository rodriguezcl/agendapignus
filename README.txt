AGENDA TÉCNICA PIGNUS
=====================

Aplicación para planificar agendas, administrar clientes, empleados, servicios
e historial técnico. La interfaz usa React/Vite. En desarrollo local persiste
en SQLite; la versión desplegada en Vercel utiliza PostgreSQL de Supabase.

INICIO
------

La forma recomendada en Windows es ejecutar `Iniciar_Agenda_Tecnica.bat`.
También puede usarse `npm run dev` desde una terminal. El sistema queda
disponible en http://localhost:5173.

ESTRUCTURA
----------

- `src/`: aplicación React.
- `src/components/ui/`: componentes visuales reutilizables.
- `src/features/`: módulos de negocio; cada funcionalidad nueva debe vivir aquí.
- `src/services/`: cliente de API y servicios compartidos.
- `server.cjs`: API local, reglas de persistencia y SQLite.
- `api/`: API serverless de Vercel y acceso a PostgreSQL/Supabase.
- `supabase/`: migraciones reproducibles del esquema PostgreSQL.
- `data/`: base de datos e importaciones; no se versiona.
- `public/`: imágenes y recursos estáticos.
- `docs/ARQUITECTURA.md`: decisiones técnicas y convenciones de desarrollo.

DESARROLLO
----------

1. Ejecutar `npm install` al clonar el proyecto.
2. Ejecutar `npm run dev`.
3. Antes de entregar cambios, ejecutar `npm run build`.

PERSISTENCIA
------------

Los datos operativos se guardan en `data/agenda-tecnica.db`. No eliminar esta
carpeta si se desea conservar clientes, agendas e historial. Las copias de
seguridad deben hacerse con la aplicación detenida.

Para publicar la aplicación y migrar los datos actuales, seguir
`docs/DESPLIEGUE-VERCEL-SUPABASE.md`.

MANTENIMIENTO
-------------

El archivo `App.jsx` conserva componentes históricos durante la transición.
Al modificar una funcionalidad, extraer su módulo a `src/features/` y dejar
comentadas las reglas de negocio, validaciones y efectos de persistencia.
