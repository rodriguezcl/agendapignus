# Rendimiento de lecturas de Tickets · 2026-11-03

## Investigación de Vercel

Las recomendaciones mostradas en el panel afectan al despliegue:

- [Builds simultáneos](https://vercel.com/docs/builds/managing-builds): reducen la espera en la cola de compilación; tienen facturación por uso. No aceleran las consultas de la aplicación.
- [Publicaciones progresivas](https://vercel.com/docs/rolling-releases): permiten exponer una versión a una fracción de usuarios y comparar métricas antes de ampliarla. No reducen por sí solas el consumo de CPU.

La captura muestra Fluid Compute habilitado y Node 22.x efectivo, frente a 24.x en la configuración del panel. `package.json` fija 22.x: no se cambia de runtime como parte de esta optimización. No se activaron opciones de pago ni se modificó la cuenta de Vercel.

## Cambios implementados

- Lectura por lotes de los tickets correspondientes a avisos no leídos: 50 referencias sin fusiones necesitan una consulta en lugar de 50. Las cadenas de tickets fusionados se resuelven por niveles adicionales. El mapa existe sólo durante la solicitud y los permisos se evalúan sobre los datos actuales.
- La lista de destinatarios de escalamiento se recalcula con los permisos actuales, pero el UPSERT no actualiza la fila si su contenido no cambió. Se conserva la consulta SQL; se evita la escritura redundante.
- La comprobación de seguimientos ya migrados utiliza una consulta UNION ALL en lugar de dos. Dentro de la transacción sólo revisa candidatos nuevos, conservando la comprobación individual para evitar duplicados concurrentes. No se guarda una caché de migración entre solicitudes.
- El reloj laboral reutiliza conversiones de fecha/hora a instantes para la zona Argentina, con un límite de 1024 entradas. No guarda calendarios ni feriados: los cambios de jornada y excepciones se consideran en cada cálculo.

## Medición local

1000 cálculos sobre el mismo intervalo, sin conexión a producción:

```powershell
node -e "const c=require('./api/_lib/ticket-business-clock.cjs'); const start=performance.now();let total=0;for(let i=0;i<1000;i++)total+=c.businessMinutesBetween('2026-10-01T12:00:00Z','2026-11-03T12:00:00Z');console.log(JSON.stringify({iterations:1000,milliseconds:performance.now()-start,total}));"
```

Antes: 2673,85 ms. Después: 569,39 ms. Ambos devolvieron un total de 13980000 minutos. Es una medición orientativa de esta operación repetida (aproximadamente 79% menos tiempo), no de la latencia completa de la API ni del ahorro de facturación. La primera conversión de cada fecha todavía se calcula; la caché sólo se reutiliza mientras vive el proceso.

## Validación

119 pruebas aprobadas en los siguientes archivos, incluyendo SQLite y PostgreSQL mediante PGlite:

- `ticket-business-clock.test.cjs`
- `ticket-notification-principals.test.cjs`
- `ticket-read-performance.test.cjs`
- `tickets-store.test.cjs`
- `ticket-sla.test.cjs`
- `ticket-communications.test.cjs`
- `ticket-service-lifecycle.test.cjs`
- `ticket-notification-identity.test.cjs`

Se verifican cambios inmediatos de permisos, escrituras efectivas mediante un trigger de auditoría, cantidades de consultas, nuevas solicitudes técnicas, referencias fusionadas, calendarios modificados y conservación de la trazabilidad. Las pruebas no envían mensajes a clientes.

No se midieron tiempos ni consumo de producción. Después del despliegue corresponde comparar duración de las consultas de Tickets y CPU en Observability bajo tráfico equivalente.
