# Operación multiusuario y concurrencia

## Garantías vigentes

- Las escrituras del estado se serializan mediante la revisión global y la transacción del servidor.
- La agenda se valida nuevamente dentro de la escritura para impedir superposiciones de técnicos y equipos.
- Las tareas repetidas se deduplican por sus identificadores estables.
- Una escritura basada en una versión anterior se fusiona por registro y campo cuando los cambios son compatibles.
- Si dos sesiones cambian el mismo campo, o una elimina un registro modificado por otra, el servidor responde `409 STATE_WRITE_CONFLICT`.
- El navegador descarta guardados pendientes obsoletos y recupera el estado vigente después de un conflicto.

## Verificación

Ejecutar la batería enfocada con:

```shell
npm run test:concurrency
```

Antes de desplegar también deben aprobarse `npm test` y `npm run build`.

## Observabilidad

La API emite eventos JSON con `scope: state_concurrency`:

- `state_write_merged`: se conservaron cambios compatibles de más de una sesión.
- `state_write_conflict`: la escritura se rechazó para evitar una sobrescritura.

Los eventos contienen solamente rol, revisiones, código y ruta técnica del campo. No registran clientes, observaciones, credenciales ni contenido de la agenda.

Un aumento sostenido de `state_write_conflict` requiere revisar el flujo afectado y la ruta `conflictPath`. Las fusiones son esperables durante el trabajo simultáneo, pero una suba abrupta de `state_write_merged` puede indicar que el intervalo de actualización del cliente es insuficiente.
