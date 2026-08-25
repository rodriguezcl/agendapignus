# Arquitectura del proyecto

## Capas

- `src/`: interfaz React.
- `src/components/ui/`: componentes genéricos reutilizables.
- `src/features/`: módulos de negocio aislados por dominio.
- `src/services/`: comunicación con la API.
- `server.cjs`: API local y acceso a SQLite.
- `api/`: API serverless compatible con Vercel.
- `supabase/`: esquema PostgreSQL y controles de seguridad de producción.
- `data/`: datos de ejecución; no se versionan.
- `public/`: recursos estáticos.

## Convenciones

- Un componente por archivo cuando se inicie un módulo nuevo.
- No realizar `fetch` directamente desde componentes: usar `apiClient`.
- Documentar funciones que tengan reglas de negocio o efectos de persistencia.
- Los cambios de esquema SQLite deben ser idempotentes y estar comentados.
- Los cambios de producción deben agregarse como migraciones SQL en `supabase/migrations/`.
- Ninguna credencial de PostgreSQL puede exponerse mediante variables prefijadas con `VITE_`.
- No almacenar contraseñas reales sin hash y autenticación de servidor antes de publicar la aplicación.

## Próxima refactorización recomendada

`App.jsx` conserva componentes históricos para evitar una migración riesgosa. Las siguientes mejoras deben extraer, de a un módulo y con pruebas manuales, Agenda técnica, Historial y Administrador de cuentas a `src/features/`.
