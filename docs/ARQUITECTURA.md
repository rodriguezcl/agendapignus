# Arquitectura del proyecto

## Capas

- `src/`: interfaz React.
- `src/components/ui/`: componentes genéricos reutilizables.
- `src/features/`: módulos de negocio aislados por dominio.
- `src/services/`: comunicación con la API.
- `server.cjs`: API local y acceso a SQLite.
- `data/`: datos de ejecución; no se versionan.
- `public/`: recursos estáticos.

## Convenciones

- Un componente por archivo cuando se inicie un módulo nuevo.
- No realizar `fetch` directamente desde componentes: usar `apiClient`.
- Documentar funciones que tengan reglas de negocio o efectos de persistencia.
- Los cambios de esquema SQLite deben ser idempotentes y estar comentados.
- No almacenar contraseñas reales sin hash y autenticación de servidor antes de publicar la aplicación.

## Próxima refactorización recomendada

`App.jsx` conserva componentes históricos para evitar una migración riesgosa. Las siguientes mejoras deben extraer, de a un módulo y con pruebas manuales, Agenda técnica, Historial y Administrador de cuentas a `src/features/`.
