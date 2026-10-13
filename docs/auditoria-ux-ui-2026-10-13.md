# Auditoría de usabilidad y diseño de Agenda Pignus

**Fecha:** 13 de octubre de 2026. **Versión examinada:** código local de trabajo, incluida la renovación visual inspirada en AdminLTE todavía sin publicar.

**Actualización posterior:** se aplicaron las correcciones en la copia local. El [registro de correcciones y verificación](correcciones-ux-ui-2026-10-13.md) distingue los resultados posteriores de las evidencias originales conservadas en este informe.

La plataforma tiene una base visual más ordenada y permite completar muchos recorridos habituales. Sin embargo, todavía no puede considerarse libre de complicaciones: hay acciones que descartan trabajo, controles que desaparecen en móvil y diferencias entre lo que la interfaz muestra y lo que sus filtros encuentran. Estos problemas afectan más al uso diario que los detalles estéticos pendientes.

Se consolidaron **21 hallazgos: 2 de prioridad alta, 15 de prioridad media y 4 de presentación o eficiencia**. La prioridad expresa impacto operativo, no una certificación de accesibilidad. Los casos relacionados se agruparon para evitar contar el mismo defecto en cada módulo. El alcance de la primera reproducción se corrigió durante la implementación, como se explica en el hallazgo 1.

La pregunta central fue qué le ocurre a una persona que está preparando materiales, coordinando servicios o trabajando en la calle: si encuentra lo que necesita, entiende qué se guardó, puede corregirse sin repetir trabajo y distingue los estados sin esfuerzo. Esta revisión combina recorridos en navegador, inspección visual y mediciones; no sustituye observar a usuarios reales.

## Alcance de la revisión

Se ejecutó la aplicación completa con su navegación, estilos, permisos y efectos globales. Esto permitió detectar fallos que no aparecen al probar un componente aislado. Se utilizaron datos ficticios y respuestas de red interceptadas: no se modificaron registros de producción ni se enviaron correos reales.

Se revisaron escritorio de 1440 px y móvil de 390 px, en ambos temas donde están disponibles. Menú principal y Vehículos también se comprobaron a 320 px. El portal técnico y el acceso no ofrecen actualmente el mismo selector nocturno de la gestión; su recorrido funcional se verificó en claro. Se incluyeron teclado, formularios vacíos, borradores, errores de red, fotos, modales superpuestos y un historial sintético de 170 registros.

| Área | Recorridos comprobados | Resultado principal |
| --- | --- | --- |
| Acceso y recuperación | Campos, contraseña visible, credenciales rechazadas, solicitud sin correo y con correo | Mensajes comprensibles en las respuestas simuladas; entrega real pendiente de validación |
| Navegación y roles | Administrador, Usuario, Operador, Supervisor y Técnico; menú, perfil y campana | Foco incorrecto en menú móvil; identidad de sesión poco visible en móvil |
| Menú principal | Avisos, indicadores, cambio de período, evolución anual y detalle por ubicación | Base legible; contraste puntual insuficiente y desbordamiento a 320 px |
| Agenda semanal | Búsqueda, cambio de días, vista previa, disponibilidad, almuerzo, alta y edición, preparación, equipos y vehículos del mes, guardias | Problemas al cancelar alta y manejar teclado; varios errores de guardado se recuperan correctamente |
| Historial | Búsqueda, estados, orden, detalle, edición, reprogramación, gestión masiva y paginación | Filtro de cancelación inconsistente, descarte de borrador y navegación larga entre páginas |
| Abonados y clientes | Alta, requeridos, detalle, búsqueda vacía, cancelación de eliminación y apertura del importador | Requeridos correctos; Escape descarta la carga; importación real no ejecutada |
| Empleados | Alta, requeridos, restricciones del Operador, edición, eliminación cancelada y estado | Activo/Inactivo oculto en móvil; borrador sin protección |
| Tipos de servicio | Alta, requeridos, edición y eliminación cancelada | Etiquetas y unidades difíciles de leer en oscuro |
| Vehículos | Alta y edición, matrícula duplicada, seguro, estadísticas de kilometraje e historial de fotos | Fallos de archivos sin recuperación suficiente; borrador sin protección |
| Configuración | Meses congelados, valores inválidos, roles, permisos y acceso a Jornada laboral | Jornada laboral inaccesible; dos problemas al crear roles |
| Auditoría | Listado, detalle, búsqueda vacía y navegación por teclado | Los estados revisados son legibles; alcance de búsqueda requiere aclaración |
| Centro de ayuda | Búsqueda, apertura de artículo y ausencia de resultados | Recorrido básico correcto; ayuda de jornada remite a una sección que no aparece |
| Portal técnico | Próximo servicio, foto y mapa, inicio, informe, adjuntos, control vehicular, cámara simulada, agenda vacía y desconexión | Riesgo de perder adjuntos pendientes, doble captura y acciones frecuentes demasiado abajo |

## Hallazgos de prioridad alta

### 1 La confirmación del informe no integra los adjuntos pendientes

**Precisión posterior sobre los permisos:** la primera reproducción permitió indebidamente cargar un PDF a un técnico en un servicio normal. El servidor real sólo habilita la carga técnica en controles vehiculares asignados y mediante cámara. Por eso esa reproducción no demuestra que un técnico pueda perder un PDF en un servicio normal.

La revisión del código confirmó que las selecciones pendientes de la tarjeta y del informe se administraban por separado, y que confirmar el estado no guardaba esos adjuntos. La corrección se delimitó a compartir el borrador del mismo registro y guardar los pendientes antes de enviar el informe. Se verificó de nuevo con permisos fieles al servidor: control vehicular asignado, captura pendiente, selección de esa foto, kilometraje y confirmación.

Para un técnico, adjuntar evidencia y confirmar el informe se perciben como una sola entrega. El texto que explica el guardado independiente no previene el error. Una foto capturada en el lugar podría ser difícil de repetir.

**Corrección propuesta:** guardar los archivos pendientes junto con la confirmación, o bloquear el avance hasta guardarlos o descartarlos expresamente. Si falla la subida, conservar el informe y los archivos.

**Comprobación de cierre:** seleccionar una foto, completar y provocar un fallo de subida; el servicio no debe parecer entregado con evidencia faltante y debe permitir reintentar sin seleccionar otra vez.

Código original: `src/components/Attachments.jsx:51`, `src/App.jsx:5566`. La [captura original](../tmp/ux-audit/technician/critical-attachment-before.png) y el [registro original](../tmp/ux-audit/technician/critical-evidence.json) se conservan como antecedentes de una simulación con permisos incorrectos. La [verificación corregida](../tmp/visual-qa/technician-report/results.json) comprueba el flujo vehicular, la conservación ante fallos y el reintento sin duplicados.

### 2 Jornada laboral no aparece en la configuración de la aplicación completa

Con Administrador, Configuración presenta Meses congelados y Roles y permisos, pero no Jornada laboral. Ocurre en ambos temas y tamaños. El componente existe, pero el render activo no le entrega las propiedades que habilitan la sección.

El administrador no puede ajustar jornada, primer servicio y excepciones desde el lugar establecido. **No se observó pérdida de la configuración almacenada:** el problema comprobado es su acceso.

**Corrección propuesta:** restaurar la conexión de Settings con los datos, permisos y guardado de jornada. La verificación debe entrar desde la aplicación completa; una prueba aislada que inyecte esas propiedades no detecta esta omisión.

**Comprobación de cierre:** Administrador abre Configuración, encuentra Jornada laboral y puede recorrer sus excepciones; un rol sin permiso no obtiene acciones de modificación.

Código: `src/App.jsx:2729`, `:6393`, `:6419`. [Configuración en móvil](../tmp/ux-audit/forms/evidence/dark-390-settings.png).

## Hallazgos de prioridad media

### 3 La protección de cambios sin guardar depende del formulario

Escape descarta sin advertencia los datos escritos en nuevos clientes y empleados, una modificación de vehículo, la edición desde Historial y la observación del informe técnico. Al reabrir, el borrador desaparece. En cambio, el editor semanal sí ofrece Guardar, Seguir editando o Cancelar carga.

Una persona no debería tener que memorizar en qué pantalla puede perder trabajo. El cierre por fondo también comparte rutas directas en algunos componentes, aunque esa variante se inspeccionó en código y no se reprodujo en todos los formularios.

**Corrección propuesta:** un mismo criterio de borrador modificado para Escape, X, Cancelar, cambio de módulo y cierre por fondo; conservar el borrador o pedir descarte explícito.

**Comprobación de cierre:** escribir en cada formulario y probar las salidas sin guardar; ninguna debe borrar información silenciosamente. Un formulario intacto debe cerrar sin preguntas innecesarias.

Código: `src/components/ui/EditorModal.jsx:8`, `src/App.jsx:1619`, `:5581`, `:6002`, `:6250`, `:6321`, `:6370`. [Cliente reabierto](../tmp/ux-audit/forms/evidence/dark-390-customer-reopen.png), [informe antes de cerrar](../tmp/ux-audit/technician/report-before-close-390.png), [después de reabrir](../tmp/ux-audit/technician/report-after-reopen-390.png).

### 4 La foto del control vehicular se puede pedir dos veces

El técnico puede capturar y guardar una foto en los adjuntos del control. Al completar el mismo control, informar kilometraje no alcanza: el formulario exige otra Foto del interior y mantiene Continuar deshabilitado.

Existen dos mecanismos de fotografía que no reconocen la evidencia entre sí. Desde el trabajo real parece que la primera captura no sirvió.

**Corrección propuesta:** un único recorrido principal para kilometraje y foto obligatoria, o permitir elegir como foto del control una captura válida ya guardada para ese registro. Diferenciar claramente las fotos adicionales.

**Comprobación de cierre:** una foto válida guardada para el control permite terminarlo sin volver a capturarla, manteniendo la exigencia de evidencia.

Código: `src/App.jsx:5237`, `:5241`, `:5259`; `src/components/Attachments.jsx:41`. [Foto guardada como adjunto](../tmp/ux-audit/technician/vehicle-photo-saved-as-attachment.png), [segunda captura exigida](../tmp/ux-audit/technician/vehicle-completion-requests-another-photo.png).

### 5 Escape actúa sobre la capa equivocada

Dentro del selector Tipos de servicio, Escape cierra todo el editor en lugar de cerrar sólo el desplegable. En la captura del control vehicular, Escape cierra el informe que está detrás y deja la cámara abierta y activa. En ese segundo caso se pierde el contexto del kilometraje.

El manejador global captura la tecla antes que algunos controles internos y no contempla del mismo modo el diálogo nativo de cámara.

**Corrección propuesta:** dar prioridad a la capa superior: selector → cámara → formulario → página. Cerrar la cámara debe detener la captura y devolver el foco al informe, que debe conservarse.

**Comprobación de cierre:** abrir cada combinación de capas y pulsar Escape una vez; sólo debe cerrarse la superior. La cámara debe liberar su pista de video al cerrarse.

Código: `src/App.jsx:1561`, `:1619`, `:1665`; `src/components/ServiceTypesField.jsx:29`; `src/infrastructure/media/camera-capture.mjs:16`. [Cámara después de Escape](../tmp/ux-audit/technician/critical-camera-escape.png), [selector antes](../tmp/ux-audit/scheduling/selector-before-escape-light-1440.png), [después](../tmp/ux-audit/scheduling/selector-after-escape-light-1440.png).

### 6 Cancelar un alta deja una tarjeta vacía e intenta guardarla

Agenda semanal → disponibilidad futura → Agregar servicio → Cancelar, sin completar nada. Queda una tarjeta Servicio/Disponible además de la disponibilidad. Se registra un intento de PATCH con tarea vacía y `manualSlot:true`.

Las respuestas fueron rechazadas en el entorno simulado: se comprobó el intento de escritura, **no su persistencia en producción**. Aun así, cancelar ya altera lo que la persona ve y contradice la agenda basada en tiempo disponible.

**Corrección propuesta:** mantener el alta como borrador hasta guardar; si se usa una tarjeta provisional, retirarla al cancelar sin enviarla al autoguardado.

**Comprobación de cierre:** abrir y cancelar cinco altas deja exactamente la agenda inicial y no solicita guardar tareas vacías.

Código: `src/App.jsx:4044`, `:4257`, `:4556`, `:4574`. [Resultado en móvil](../tmp/ux-audit/scheduling/extra/cancel-new-immediate-dark-390.png), [solicitudes registradas](../tmp/ux-audit/scheduling/extra/results.json).

### 7 El filtro Cancelado no encuentra todas las filas que muestran Cancelado

Historial presenta como Cancelado tanto una cancelación administrativa como una informada por un técnico pendiente de revisión. Al seleccionar Estado = Cancelado, esta última desaparece. El filtro usa el estado interno y la etiqueta usa una transformación diferente.

El usuario utiliza el término que ve y obtiene un resultado incompleto, justo al revisar incidencias.

**Corrección propuesta:** definir una única interpretación de estado para etiqueta, filtro, contador y exportación, conservando el detalle de quién informó la cancelación.

**Comprobación de cierre:** ambos tipos de cancelación visibles con la misma etiqueta aparecen al filtrar esa etiqueta.

Código: `src/App.jsx:5786`; `src/domain/dashboard/dashboard-metrics.mjs:52`. [Sin filtro](../tmp/ux-audit/scheduling/cancelled-all-light-1440.png), [con filtro](../tmp/ux-audit/scheduling/cancelled-filter-light-1440.png).

### 8 Crear una reserva PIG o un CLI requiere puntero

Al escribir un cliente sin coincidencias aparecen Reservar nuevo abonado y Agregar cliente CLI. Al avanzar con Tab, el campo pierde foco, la lista se cierra y los botones desaparecen antes de poder accionarlos. El foco termina en el cuerpo de la página.

Las flechas y Enter sirven para clientes existentes, pero no resuelven estas altas.

**Corrección propuesta:** mantener la lista abierta mientras el foco esté dentro del conjunto y usar botones con activación normal por teclado, además del puntero.

**Comprobación de cierre:** completar ambos recorridos usando solamente Tab, Shift+Tab y Enter, sin perder el foco.

Código: `src/App.jsx:1019`, `:1027`. [Acciones disponibles](../tmp/ux-audit/scheduling/reservation-options-light-1440.png), [después de Tab](../tmp/ux-audit/scheduling/reservation-after-tab-light-1440.png).

### 9 El menú móvil deja el foco detrás del panel

Al abrir el menú lateral a 390 px, Tab puede enfocar la campana cubierta por el fondo en gestión. En el portal técnico el foco permanece en el cuerpo o vuelve a la hamburguesa situada detrás. La apertura no lleva al contenido del menú y el cierre no siempre devuelve el foco al botón.

**Corrección propuesta:** enfocar el menú al abrir, impedir que el contenido tapado reciba foco y restaurarlo al cerrar. Alinear los atributos de accesibilidad del menú técnico con el comportamiento real.

**Comprobación de cierre:** recorrer el panel con teclado sin alcanzar acciones ocultas; cerrarlo y continuar desde su disparador.

Código: `src/App.jsx:1474`, `:1636`, `:2729`, `:5333`. [Foco detrás del menú](../tmp/ux-audit/technician/admin-drawer-focus-dark.png). El criterio de foco y retorno sigue el patrón de [diálogos modales de WAI](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) cuando el panel cubre y bloquea la página.

### 10 Activo e Inactivo desaparecen de Empleados en móvil

En escritorio se puede consultar y cambiar el estado del empleado. A 390 px la columna completa queda oculta por CSS; la tarjeta conserva editar y eliminar, pero el formulario de edición tampoco ofrece ese estado.

No se trata sólo de mostrar menos información: se pierde una acción de administración de acceso.

**Corrección propuesta:** incorporar el estado y su acción a la tarjeta móvil con la misma confirmación que en escritorio.

**Comprobación de cierre:** distinguir un empleado activo de uno inactivo y acceder al cambio desde el teléfono, sin depender de eliminarlo.

Código: `src/style.css:27`; `src/App.jsx:6365`, `:6370`. [Empleados en móvil](../tmp/ux-audit/forms/evidence/dark-390-employees.png).

### 11 Las acciones frecuentes del técnico quedan demasiado abajo

Con un servicio que tiene foto y mapa, Iniciar servicio comienza en **y = 1377 px en una pantalla de 390 × 844**. Cómo llegar y Llamar aparecen aún después. Antes se muestran presentación, datos del servicio, foto, mapa, equipo, detalle y adjuntos.

La foto y el mapa caben correctamente en ancho, pero desplazan lo más necesario al llegar a un domicilio. Es un problema de prioridad, no de desbordamiento.

**Corrección propuesta:** situar Iniciar, Cómo llegar y Llamar cerca del horario y cliente. Mantener foto, mapa y detalle debajo, ampliables cuando hagan falta; evitar que todas las explicaciones precedan a las acciones.

**Comprobación de cierre:** entrando al próximo servicio desde un teléfono, reconocer y alcanzar las acciones principales sin recorrer casi dos pantallas.

Código: `src/App.jsx:5215`, `:5460`, `:5581`. [Tarjeta completa del técnico](../tmp/ux-audit/technician/regular-390.png).

### 12 Nuevo rol permite llegar a la confirmación con nombre vacío

Configuración → Nuevo rol → Guardar rol sin nombre abre «¿Querés confirmar los cambios del rol ?». No se confirmó esa operación: no se afirma que el servidor acepte guardar un rol sin nombre.

**Corrección propuesta:** validar el nombre después de quitar espacios, mostrar el error al lado del campo y enfocarlo antes de permitir confirmar.

**Comprobación de cierre:** vacío o espacios no abren confirmación; un nombre válido sí permite continuar.

Código: `src/App.jsx:6396`, `:6407`, `:6419`. [Confirmación con nombre vacío](../tmp/ux-audit/forms/evidence/dark-390-role-empty-save.png).

### 13 El editor de nuevo rol aparece fuera de la pantalla móvil

Con scroll inicial cero, al pulsar Nuevo rol a 390 × 960, su primer campo queda en y = 1139 px. El foco permanece en el botón y no se desplaza la página. La acción puede parecer que no respondió.

**Corrección propuesta:** enfocar y hacer visible el primer campo, o utilizar el mismo patrón de diálogo que los otros catálogos.

**Comprobación de cierre:** pulsar Nuevo rol presenta inmediatamente el lugar donde escribir, tanto con teclado como con toque.

Código: `src/App.jsx:6419`. [Editor abierto en móvil](../tmp/ux-audit/forms/evidence/dark-390-role-new.png); coordenadas en [mediciones del formulario](../tmp/ux-audit/forms/evidence/results.json).

### 14 Persisten textos de contraste insuficiente

Las mediciones de colores computados encontraron ejemplos concretos:

| Texto | Tema y contexto | Contraste |
| --- | --- | --- |
| Tiempo estimado | Oscuro, alta de Tipo de servicio | 2,22 a 1 |
| Unidades h y min | Oscuro, mismo formulario | 3,04 a 1 |
| Servicio del sistema | Oscuro, chip del catálogo | 2,22 a 1 |
| Descargar PDF | Oscuro, seguro del vehículo | 2,14 a 1 |
| Variación positiva del indicador | Oscuro, Menú principal | 2,86 a 1 |
| Cantidad de Docta | Claro, detalle por ubicación | 2,70 a 1 |

Se midieron texto y fondo efectivos, no píxeles suavizados de capturas. La referencia habitual es 4,5 a 1 para texto normal y 3 a 1 para texto grande; el valor de Docta tampoco alcanza este último. [WCAG sobre contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

**Corrección propuesta:** aplicar colores semánticos del tema también a etiquetas internas, unidades, enlaces y valores. Conservar colores de estado cuando ayudan a distinguirlos, pero con luminosidad suficiente sobre el fondo.

**Comprobación de cierre:** verificar ambos temas en esos elementos y estados activo, foco, error y deshabilitado; no corregir el problema convirtiendo todos los indicadores en un mismo color.

Código: `src/style.css:19`, `:163`; `src/ui-polish.css:316`; indicadores en `src/App.jsx`. [Alta de servicio oscura](../tmp/ux-audit/forms/evidence/dark-390-service-new.png), [Vehículos oscuro](../tmp/ux-audit/dashboard-vehicles/vehicles-dark-390.png), [mediciones](../tmp/ux-audit/dashboard-vehicles/results.json).

### 15 Algunos fallos de archivos no explican qué pasó ni permiten recuperarse

Se comprobaron dos variantes. Si la lista de fotos del control carga, pero una imagen responde 403, queda una miniatura rota sin mensaje ni Reintentar. Si la descarga del seguro responde 503, la descarga se cancela y la aplicación no muestra un aviso.

La persona pulsa una función y no sabe si esperar, repetir o comunicar un problema. El manejo de error de la lista de adjuntos no cubre el fallo individual de la imagen.

**Corrección propuesta:** estado de error por imagen y reintento; para descargas, detectar la respuesta fallida y mostrar un mensaje visible conservando el contexto. Diferenciar «sin fotos» de «no se pudieron cargar».

**Comprobación de cierre:** simular una URL vencida y una descarga fallida; no deben parecer ausencia de evidencia ni quedar sin explicación.

Código: `src/components/VehicleControlPhotos.jsx:27`; enlace de seguro en `src/App.jsx:6330`. [Imagen fallida](../tmp/ux-audit/supplemental/broken-photo-dark-390.png), [mediciones de recuperación](../tmp/ux-audit/supplemental/results.json). No se extrapola esta prueba a todas las exportaciones.

### 16 El cierre tapa la fecha en el detalle móvil de Supervisor

En el detalle del servicio CCTV, la X aparece sobre el comienzo de la fecha. Se observó en las capturas de móvil de ambos temas. La causa exacta dentro de la cascada CSS todavía requiere aislarse.

**Corrección propuesta:** reservar espacio para el cierre dentro de una cabecera común, sin posicionarlo encima del contenido.

**Comprobación de cierre:** fecha completa, estado y botón de cerrar permanecen legibles con títulos extensos y a 320 y 390 px.

Código relacionado: `src/App.jsx:6181`; `src/components/ui/modal-chrome.css:40`; `src/presentation/theme/forms.css:104`. [Superposición visible](../tmp/ux-audit/technician/supervisor-detail-dark-390.png).

### 17 La tabla accesible del gráfico produce desbordamiento a 320 px

El documento del Menú principal mide 342 px con una ventana de 320 px. El origen es la tabla oculta de datos de Evolución anual: su ancho mínimo de contenido se extiende fuera de pantalla. El SVG visible no es el responsable. A 390 px no se observó este fallo.

**Corrección propuesta:** ocultar visualmente el contenedor de la tabla sin que participe en el ancho de la página, conservando su disponibilidad para tecnología de apoyo.

**Comprobación de cierre:** a 320 px el documento no necesita desplazamiento horizontal y los datos del gráfico siguen disponibles de forma accesible. La referencia de reflujo de WCAG contempla 320 píxeles CSS, con excepciones para contenido que realmente necesita dos dimensiones; aquí el desbordamiento procede de contenido oculto. [WCAG sobre reflujo](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

Código: `src/components/annual-evolution-chart.css:257`. [Identificación de los elementos desbordados](../tmp/ux-audit/supplemental/results.json).

## Hallazgos de presentación y eficiencia

### 18 Quedan superficies claras y verdes fuera del tema nocturno

Historial de cambios, dentro de Equipos del mes y Guardias del año, conserva fondo casi blanco y texto verde. Sus reglas oscuras esperan `body.dark`, mientras la aplicación utiliza `.app-shell[data-theme=dark]`. El aviso de nueva versión también mantiene fondo blanco y texto verde definidos directamente en el componente; este caso se verificó con el hook real y una versión simulada.

**Corrección propuesta:** aplicar el tema a componentes incrustados, portales y avisos globales con el mismo mecanismo y colores compartidos. Evitar seguir sumando excepciones de selectores incompatibles.

**Comprobación de cierre:** abrir los dos historiales y disparar una actualización pendiente en oscuro sin bloques blancos. Los acentos de estado pueden conservar color si tienen función y contraste.

Código: `src/weekly-enhancements.css:1493`; `src/dark-neutral-legacy.css:728`; `src/components/DeploymentUpdate.jsx:102`. [Historial de cambios](../tmp/ux-audit/scheduling/monthly-teams-dark-390.png), [aviso de actualización](../tmp/ux-audit/supplemental/update-banner-dark-390.png).

### 19 La paginación del Historial obliga a volver al principio manualmente

Con 130 coincidencias y 50 filas por página, Siguiente deja al usuario al final del documento: aproximadamente 12.802 px de desplazamiento en móvil. La nueva página existe, pero su comienzo queda muy lejos. Además, cambiar de página vacía la selección sin aclarar que se limita a esa página.

**Corrección propuesta:** llevar foco y vista al comienzo del listado al cambiar de página, u ofrecer paginación también arriba. Definir si la selección persiste entre páginas; si no, rotular «Seleccionar esta página» y explicar el alcance.

**Comprobación de cierre:** recorrer tres páginas y preparar un lote sin perder de vista qué registros están seleccionados.

Código: `src/App.jsx:5795`, `:5932`, `:5956`. [Segunda página con scroll al final](../tmp/ux-audit/scheduling/volume/history-page2-bottom-light-390.png).

### 20 Las confirmaciones cortas ocupan casi todo el escritorio

Eliminar cliente o confirmar un rol abre un diálogo de 1408 px en una pantalla de 1440 px, aunque sólo contenga unas líneas. Una regla general anula el máximo específico de 420 px.

**Corrección propuesta:** conservar un ancho compacto para confirmaciones y reservar los diálogos amplios para datos que lo necesitan. El límite de pantalla debe reducir el tamaño cuando haga falta, no ampliar todos los modales.

**Comprobación de cierre:** confirmaciones compactas en escritorio y adaptadas al ancho móvil, sin modificar los formularios extensos.

Código: `src/presentation/theme/forms.css:86`; `src/style.css:23`. [Confirmación de eliminación](../tmp/ux-audit/forms/evidence/light-1440-customer-delete.png).

### 21 Un error de matrícula conserva semántica e icono de éxito

«Ya existe un vehículo con esa matrícula» se muestra con una tilde; el contenedor tiene `data-tone=success` y `role=status`. El aviso sí es visible sobre el modal: el defecto es la contradicción entre mensaje, icono y clasificación.

**Corrección propuesta:** entregar el tipo de aviso explícitamente desde la operación y renderizar su icono correspondiente, evitando deducir éxito o error de unas palabras iniciales.

**Comprobación de cierre:** matrícula duplicada se anuncia como error y un guardado correcto como éxito, ambos legibles en los dos temas.

Código: `src/App.jsx:133`, `:2729`. [Aviso de matrícula duplicada](../tmp/ux-audit/dashboard-vehicles/vehicle-duplicate-error-dark-1440.png).

## Aspectos que funcionaron correctamente

Los formularios básicos de cliente, empleado y tipo de servicio bloquean campos obligatorios vacíos. El Operador tiene una explicación cuando no puede recibir función técnica. Las eliminaciones revisadas identifican el registro y permiten cancelar.

En la agenda, búsqueda, vista previa, disponibilidad, almuerzo y separación de equipos son comprensibles en los estados examinados. El tablero permite su desplazamiento horizontal deliberado sin desbordar el documento a 390 px. La protección del borrador semanal funciona y sirve como referencia para otros formularios.

Un fallo de guardado del editor semanal conserva los datos. Los adjuntos de ese editor mantienen dos PDF pendientes al fallar la subida y permiten reintentar. El cambio de Servicio listo que falla conserva el estado anterior e informa que no se modificó la preparación.

El informe técnico conserva su texto cuando falla el envío y permite reintentar. La agenda vacía se distingue de un problema de conexión. La denegación simulada de cámara ofrece una explicación en español. Foto y mapa se pueden presentar juntos y ampliar el mapa sin desbordar el ancho; queda pendiente mejorar la prioridad de sus acciones.

Los listados y detalles de Auditoría revisados son legibles en oscuro. Los ciclos de teclado de los modales de catálogos permanecieron dentro del diálogo. La campana y el perfil de escritorio cierran con Escape devolviendo el foco correctamente. Estos resultados no contradicen los fallos específicos de menús y capas anidadas.

## Mejoras adicionales que conviene evaluar

| Observación | Propuesta y límite de la evidencia |
| --- | --- |
| En móvil de gestión se oculta el perfil completo | Mantener avatar o identidad dentro del menú para reconocer la sesión; no se observó confusión en usuarios reales |
| El mes elegido puede ser de 2025 mientras Acumulado anual indica 2026 | Ambos años están rotulados; aclarar visualmente qué bloques controla el selector, sin presentar los valores como incorrectos |
| Permisos conserva Agenda del día y Horarios del mes | Actualizar la terminología para alinearla con la navegación actual; comprobar antes el efecto de cada permiso heredado |
| Auditoría solicita los últimos 100 registros y filtra localmente | Informar el alcance o habilitar búsqueda/paginación remota; no se reprodujo con más de 100 acciones en esta revisión |
| Reprogramar en móvil puede apilar decenas de horarios | Agrupar por equipo y mañana/tarde o facilitar saltos; se observó longitud, no imposibilidad de uso |
| Algunos errores transitorios desaparecen a los cinco segundos | Para operaciones que requieren corregir un formulario, mantener también el mensaje dentro de él; el error del lote sí se vio sobre el modal |

No conviene eliminar todo color del modo noche. El gris debe ordenar superficies y campos; amarillo, rojo, verde y azul pueden seguir diferenciando categorías y estados cuando su significado sea estable y legible.

## Orden recomendado de corrección

| Etapa | Resultado esperado | Hallazgos |
| --- | --- | --- |
| Conservar trabajo y acceso | No perder evidencia ni borradores; recuperar Jornada laboral; unificar foto del control y cierre de capas | 1 a 5 |
| Hacer confiable la gestión | Cancelar no crea residuos; filtros coinciden con etiquetas; teclado y móvil mantienen todas las acciones; roles se validan | 6 a 13 |
| Completar legibilidad y recuperación | Contraste suficiente, archivos fallidos explicados, cabeceras sin superposición y reflujo correcto | 14 a 18 |
| Afinar eficiencia | Paginación previsible, confirmaciones compactas y avisos coherentes | 19 a 21 |

Las comprobaciones deben recorrer la aplicación completa. El control local `scripts/ux-quality-gate.cjs` dio **100/100 y 21/21**, pero se basa en buscar patrones de código. Ese resultado no demuestra que el usuario pueda completar sus tareas: todos los fallos anteriores coexistieron con ese aprobado. No corresponde asignar una nota global de usabilidad basada en esa herramienta.

Después de corregir los bloqueos, conviene realizar recorridos breves con un administrador, una persona que prepara materiales y un técnico, observando si pueden: reservar un PIG, corregir una carga sin perderla, localizar una cancelación, preparar un servicio pasado y completar un control con una sola foto. Registrar dudas, retrocesos y ayuda requerida aporta más que preguntar únicamente si el diseño les gusta. La prevención de errores, visibilidad del estado y control del usuario son criterios de referencia de las [heurísticas de usabilidad de Nielsen](https://www.nngroup.com/articles/ten-usability-heuristics/).

## Límites y evidencia reproducible

Esta es una revisión amplia de los recorridos implementados, no una certificación de todas las combinaciones posibles. No se validaron cámara física ni permisos de Android/iOS, teclado virtual, Safari, GPS y mapas reales, llamadas, entrega de correo, almacenamiento remoto, concurrencia de usuarios, importaciones extensas ni todos los escenarios comerciales y de jornadas múltiples. Tampoco se utilizó un lector de pantalla real ni se observó a usuarios trabajando con datos propios.

El volumen se evaluó principalmente en Historial y Agenda. El resto de los catálogos usó datos representativos pequeños. Las respuestas fallidas y exitosas mencionadas fueron simuladas; no acreditan persistencia en el servidor real. La revisión de roles comprueba interfaz y algunas reglas de código, no constituye una auditoría de seguridad. Los posibles problemas del proyecto local no se atribuyen automáticamente a la versión publicada.

| Evidencia local | Contenido |
| --- | --- |
| [Catálogos y configuración](../tmp/ux-audit/forms/findings.json) | Casos, líneas, 124 capturas iniciales y comprobaciones adicionales de contraste |
| [Agenda e Historial](../tmp/ux-audit/scheduling/INFORME.txt) | Casos base, volumen, adjuntos y errores; escenarios finales en ambos temas y anchuras |
| [Portal técnico y roles](../tmp/ux-audit/technician/findings.md) | Recorridos, cámara simulada, solicitudes de adjuntos y límites por rol |
| [Menú principal y Vehículos](../tmp/ux-audit/dashboard-vehicles/results.json) | Geometría, contraste, modales y validación a 1440, 390 y 320 px |
| [Pruebas complementarias](../tmp/ux-audit/supplemental/results.json) | Archivos fallidos, conservación del formulario, desbordamiento y aviso de actualización |

Los scripts reproducibles están en `tmp/ux-audit/forms/audit.cjs`, `tmp/ux-audit/scheduling/audit.cjs`, `tmp/ux-audit/technician/audit.cjs`, `tmp/ux-audit/root-audit.cjs` y `tmp/ux-audit/supplemental.cjs`. Utilizan Node, esbuild, Playwright y Edge, con interceptación de red. Las capturas de primeras iteraciones fallidas de los datos de prueba no sustentan los hallazgos; se utilizan los casos finales enlazados arriba.

**Estado de la auditoría original:** investigación y documentación completadas sin cambios de producto ni publicación. Posteriormente, a pedido del usuario, se implementaron las correcciones documentadas en el [registro de implementación](correcciones-ux-ui-2026-10-13.md). Las capturas anteriores muestran el estado previo, no el resultado corregido.
