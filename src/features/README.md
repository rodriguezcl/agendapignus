# Módulos funcionales

Cada feature representa una capacidad visible del producto (`agenda`, `history`,
`customers`, `employees`, `services`, `configuration` o `dashboard`).

- `presentation/` contiene la pantalla y sus componentes específicos.
- `application/` coordina casos de uso cuando la feature lo necesita.
- Las reglas reutilizables pertenecen a `src/domain/<dominio>`.
- Los accesos HTTP pertenecen a `src/infrastructure/repositories`.
- Los componentes visuales transversales pertenecen a `src/presentation` o
  `src/components/ui` mientras se completa la migración.

Una feature puede importar dominio e infraestructura, pero nunca debe ser
importada desde `domain`.
