# Plan de migración y corte al modelo normalizado

## Estado del manifiesto

Manifiesto generado el 9 de septiembre de 2026 mediante una transacción productiva
`REPEATABLE READ, READ ONLY` y un ensayo posterior en PostgreSQL aislado.

- Contrato: `normalized-v1-2026-09-09`.
- Revisión de origen: `7290`.
- Huella de origen: `692ad3384f7f5623dd9d317db5d4783b5de6a9ba6882a7977a79269698c9764c`.
- Huella del manifiesto: `af8d6f4d8a0607016bee0bc5c0f068ddfea0cb7db6a8a6c1dea1ca06230b7337`.
- Orígenes: 598 trabajos, 1209 clientes, 12 empleados, 12 servicios y 3 vehículos.
- Dependencias: 0 sesiones activas, 100 eventos de auditoría, 0 fotos de control y
  3 seguros vehiculares.
- Huérfanos en sesiones, fotos y seguros: 0.

El manifiesto declara `safeToPrepareMigration: true` y `readyForCutover: true`.
La certificación corresponde exclusivamente a la revisión y huella indicadas: cualquier
escritura posterior en producción la invalida y obliga a repetir el ensayo. La normalización
no fue aplicada a producción.

## Condiciones bloqueantes

No quedan bloqueos de integridad ni de implementación en el manifiesto certificado.
El ensayo integral se ejecutó en el branch PostgreSQL aislado `staging-normalization` y
finalizó con rollback completo. La evidencia segura, sin credenciales ni datos personales,
se conserva en `docs/staging-cutover-certification.json`.

## Secuencia autorizable

### 1. Preparación aditiva

- Crear el esquema nuevo sin eliminar, renombrar ni alterar tablas `pignus_*` existentes.
- Registrar el contrato de esquema y rechazar cualquier contrato diferente.
- Ejecutar el DDL dos veces en ensayo; la segunda ejecución debe ser inocua.
- Mantener RLS y revocar acceso a roles de navegador.

### 2. Repositorio y comparación en sombra

- Implementar el repositorio normalizado detrás de una opción de servidor desactivada.
- Mantener el repositorio antiguo como única fuente de escritura.
- Ejecutar lecturas paralelas de comparación sin devolver el resultado de sombra al usuario.
- Comparar cantidades, IDs, estados, agenda, permisos e indicadores; no registrar datos
  personales en logs de diferencias.

Estado local: el modo predeterminado es `persistent`. Si el esquema nuevo no está instalado,
la aplicación conserva compatibilidad legado; cuando está preparado, consulta
`normalized_shadow.storage_control` y devuelve exactamente el modelo activo. Los guardados
generales y las rutas especializadas sincronizan legado y normalizado dentro de la misma
transacción. Un conflicto o una restricción revierte ambos modelos.

La integración cubre gestión individual de historial, informe técnico y foto, adelantos,
limpieza diaria, importación y deshacer, seguros, catálogos, vehículos, agenda y configuración.
Auditoría, respaldos auxiliares y binarios también se reflejan transaccionalmente.

### 3. Copia consistente

- Abrir una transacción y bloquear la fila `state_revision`, que ya serializa las
  operaciones de escritura de la aplicación.
- Verificar revisión y huella exactas del manifiesto aprobado.
- Importar por lotes datos relacionales y evidencia; una reejecución con el mismo lote
  debe verificar el resultado existente en vez de duplicarlo.
- Copiar adjuntos por streaming. Comparar cantidad, tamaño y SHA-256 antes de agregar
  o validar claves foráneas.
- No copiar tokens de sesión. Los hashes de contraseña se trasladan mediante una ruta
  privilegiada separada del ensayo y nunca aparecen en manifiestos o logs.

### 4. Activación atómica

- Desplegar previamente una versión capaz de leer ambos modelos, con el antiguo activo.
- En una ventana breve de mantenimiento, repetir la comparación de revisión y huella,
  aplicar cualquier delta y cambiar `storage_model` dentro de la misma transacción.
- Invalidar sesiones para obligar un nuevo inicio de sesión.
- Confirmar creación, edición, eliminación, reprogramación y completado desde dos sesiones,
  además de estadísticas y descarga de seguros.

### 5. Reversión ensayada

- Registrar en un diario transaccional cada escritura realizada después del corte.
- Para revertir, detener escrituras, reproducir ese diario sobre el modelo anterior,
  comparar huellas e indicadores y recién entonces reactivar `storage_model=legacy`.
- Invalidar nuevamente sesiones. No borrar el esquema normalizado ni sus evidencias.
- Conservar ambos modelos durante el período de observación definido por Administración.

Estado local: se ensayaron escrituras posteriores, reversión de ambos modelos y una nueva
revisión monotónica. También se comprobó que un conflicto o una restricción del modelo
normalizado revierte la escritura legado ejecutada en la misma transacción. El selector ya
está integrado; falta ejecutar el ensayo equivalente en PostgreSQL de staging.

El ensayo físico tomó de producción en modo de solo lectura la revisión 7290, importó temporalmente 598 trabajos,
1209 clientes, 12 hashes de credenciales, 100 eventos de auditoría, 11 preferencias
auxiliares y 3 seguros. Comparó los adjuntos byte por byte, descartó la sesión encontrada,
ejecutó una escritura posterior al corte, restauró ambos modelos y terminó nuevamente en
`legacy`. La transacción completa de staging fue revertida: ni staging ni producción
conservaron modificaciones.

## Comandos sin escritura

```powershell
npm run inventory:normalization
npm run inventory:database-schema
npm run plan:normalization-cutover
npm run analyze:normalization -- --production-read-only --rehearse
npm run rehearse:staging-postgres
```

El ensayo de staging exige `STAGING_DATABASE_URL`, rechaza que coincida con producción,
requiere una base aislada y revierte por completo DDL, datos, activación y escrituras. La
certificación obtenida queda invalidada automáticamente si cambian la revisión o la huella
de producción.
