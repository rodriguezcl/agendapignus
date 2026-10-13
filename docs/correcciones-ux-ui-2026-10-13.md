# Correcciones de la auditoría UX/UI

**Fecha:** 13 de octubre de 2026. **Estado:** implementación y validación completadas; publicación autorizada por el usuario.

Se corrigieron los 21 hallazgos consolidados de la [auditoría](auditoria-ux-ui-2026-10-13.md). El objetivo principal fue conservar el trabajo del usuario, hacer coherentes las acciones y permitir completar los recorridos con teclado y en pantallas pequeñas. Se mantienen los cambios visuales anteriores inspirados en AdminLTE.

## Cambios y comprobación

| N.º | Corrección aplicada | Comprobación |
| --- | --- | --- |
| 1 | La tarjeta y el informe técnico comparten los adjuntos pendientes. Se suben antes de enviar el estado, conservando los que fallan. | Un fallo de subida bloquea el envío; un fallo posterior del estado permite reintentar sin subir dos veces la evidencia. |
| 2 | Jornada laboral recibe datos, permisos y guardado desde el render activo de Configuración. | Acceso desde la aplicación completa en ambos temas y tres anchuras. |
| 3 | Clientes, empleados, vehículos, Historial e informe técnico protegen sus borradores. | Escape, X, fondo, Cancelar, navegación y recarga según el recorrido; Seguir editando conserva valores. Un formulario intacto no pregunta. |
| 4 | El control vehicular admite una captura pendiente o una foto guardada de ese mismo control. | Se finaliza con kilometraje y la foto elegida sin una segunda captura. |
| 5 | Escape respeta primero el desplegable o diálogo de cámara activo. | Cierra esa capa y conserva el editor y su información. |
| 6 | Agregar un servicio desde disponibilidad crea un borrador local hasta guardar. | Cinco cancelaciones seguidas no envían escrituras ni dejan servicios vacíos. |
| 7 | El filtro de Historial utiliza el mismo estado que la etiqueta visible. | Cancelado incluye las cancelaciones informadas por técnicos. |
| 8 | Las opciones de reserva PIG y creación CLI pueden activarse con teclado. | Tab y Enter alcanzan y ejecutan ambas opciones; Escape cierra el selector. |
| 9 | El menú móvil conserva el foco dentro, desactiva temporalmente el fondo y devuelve el foco al botón al cerrar. | Tab, Shift+Tab y Escape en gestión y portal técnico. |
| 10 | Activo/Inactivo de empleados permanece disponible en móvil. | Visible sin desbordamiento a 320 y 390 px. |
| 11 | Las acciones principales del técnico aparecen antes de la foto y el mapa. | Geometría del orden comprobada a 390 y 1440 px. |
| 12 | El nombre de un rol es obligatorio, se recortan espacios y se explica el error. | Vacío y sólo espacios no abren confirmación ni guardan. |
| 13 | Al crear o editar un rol, el campo recibe foco y se desplaza hasta quedar visible. | Comprobado en escritorio y móvil. |
| 14 | Etiquetas, unidades y valores del tablero usan colores semánticos de contraste adecuado. | Los textos puntuales revisados superan 4,5:1 en ambos temas. |
| 15 | Las fotos fallidas y las descargas de seguro ofrecen error y reintento. | Fallo y recuperación por archivo, PDF válido, tiempo máximo y ausencia de navegación a un error de API. |
| 16 | El cierre del detalle del Supervisor queda anclado sin tapar la fecha. | Comparación de los rectángulos del texto y botón a 390 px, claro y oscuro. |
| 17 | La tabla accesible del gráfico anual conserva su contenido sin ampliar el documento. | Menú principal sin desbordamiento a 320 px. |
| 18 | Historial de configuración y aviso de actualización usan las superficies y textos del tema. | Verificación específica de los componentes en claro y oscuro. |
| 19 | Cambiar de página en Historial vuelve al comienzo del listado y conserva la selección global. | Recorrido de tres páginas, selección de página disponible en móvil y acción Quitar selección. |
| 20 | Las confirmaciones cortas respetan su ancho máximo de 420 px. | Escritorio y ajuste al espacio disponible en móvil. |
| 21 | La matrícula duplicada se anuncia como error, con icono de alerta; el éxito conserva su tilde. | Semántica, icono visible y contraste en ambos temas, incluso sobre un modal. |

También se muestra la identidad de la sesión dentro del menú móvil. Al revisar el descarte de servicios se corrigió una inconsistencia adicional: un valor de Meses congelados sin registrar se restauraba como cadena vacía y dejaba el formulario aparentemente modificado. Ahora descartar restablece el valor original y el formulario queda limpio.

La actualización manual y la actualización por despliegue detectan los adjuntos técnicos pendientes y las operaciones en curso. Los guardados y la preparación de fotos exponen su estado ocupado para impedir una recarga mientras trabajan.

## Evidencia posterior

Las pruebas de navegador utilizan la aplicación real, datos ficticios y red interceptada. No se crearon servicios, clientes ni vehículos reales. Los enlaces a `tmp/` corresponden a evidencias locales conservadas en el equipo; no se versionan ni se incluyen en el despliegue.

| Verificación | Resultado y evidencia |
| --- | --- |
| Agenda e Historial | 24 escenarios aprobados, 1440/390 px y ambos temas; [resultados](../tmp/ux-audit/scheduling-fixed/results.json). |
| Catálogos y recuperación | 4 combinaciones aprobadas, con borradores, guardados, navegación, roles y reintentos; [resultados](../tmp/visual-qa/catalog-recovery/results.json). |
| Navegación, contraste y avisos | 6 combinaciones aprobadas, 1440/390/320 px y ambos temas; [resultados](../tmp/visual-qa/ux-audit-fixes/results.json). |
| Portal técnico y Supervisor | Informe, cámara simulada, foto guardada, errores, reintento y foco aprobados; [resultados](../tmp/visual-qa/technician-report/results.json). |
| Historial de configuración y nueva versión | Claro/oscuro a 390 px, contraste, superficies, bloqueo de recarga y recuperación aprobados; [resultados](../tmp/ux-audit/history-deployment-fixed/results.json). |
| Actualizar durante un guardado | Guardado de vehículo y de estado técnico retenidos: aviso sin recarga y finalización correcta al liberar la respuesta; [vehículo](../tmp/visual-qa/catalog-recovery/busy-results.json), [informe técnico](../tmp/visual-qa/technician-report/busy-results.json). |
| Suite general | **859 pruebas aprobadas, 0 fallidas**; [salida completa](../tmp/ux-audit-final-tests.txt). |
| Compilación | `npm run build` finalizó correctamente. Vite mantiene advertencias por su API CommonJS y tamaño del paquete principal; no impiden compilar. |

Los scripts se guardan en `scripts/verify-scheduling-ux.cjs`, `scripts/verify-catalog-recovery.cjs`, `scripts/verify-ux-audit-fixes.cjs`, `scripts/verify-technician-report.cjs` y `scripts/verify-history-deployment-ux.cjs`. Además de las pruebas funcionales, se inspeccionaron capturas de los estados corregidos.

La primera prueba de adjuntos de la auditoría empleaba permisos más amplios que el servidor real. Se corrigió expresamente ese alcance en el informe y se repitió la verificación con un control vehicular asignado y capturas de cámara. No se amplió el permiso de carga de archivos de los técnicos.

## Límites

Esta validación no equivale a probar cámara física, permisos de Android/iOS, Safari, teclado virtual, GPS, correo ni almacenamiento de producción. Tampoco sustituye una prueba con usuarios reales. Las sugerencias exploratorias del apartado «Mejoras adicionales» de la auditoría, como búsqueda remota de Auditoría o reorganizar horarios extensos, no formaban parte de los 21 defectos corregidos.
