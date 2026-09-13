# AGENDA PIGNUS — UX/UI CONSTITUTION

**Versión:** 1.0  
**Tipo de producto:** Enterprise Operations / Field Service Management  
**Plataformas:** Desktop Web + Mobile Web  
**Usuarios principales:** Administradores / Técnicos  
**Frecuencia de uso:** Intensiva — aproximadamente 9 horas diarias, 5 días por semana.

---

# 1. PROPÓSITO

Esta Constitución define los principios obligatorios de UX, UI, interacción, accesibilidad y diseño visual de Agenda Pignus.

Toda decisión de diseño deberá priorizar:

1. Eficiencia operacional.
2. Claridad.
3. Prevención de errores.
4. Baja carga cognitiva.
5. Visibilidad del estado del sistema.
6. Consistencia.
7. Accesibilidad.
8. Velocidad de operación.
9. Densidad de información adecuada.
10. Ergonomía para sesiones prolongadas.

La estética es importante, pero nunca deberá perjudicar la eficiencia operacional.

Agenda Pignus NO deberá diseñarse como una aplicación promocional, una landing page o una aplicación social.

Es una herramienta profesional utilizada repetidamente durante toda la jornada laboral.

---

# 2. PRINCIPIO FUNDAMENTAL

> El sistema deberá adaptarse al trabajo del usuario. El usuario no deberá adaptarse al sistema.

Ante dos soluciones funcionalmente equivalentes deberá elegirse aquella que:

- requiera menos decisiones;
- requiera menos memoria;
- necesite menos interacciones;
- reduzca desplazamientos innecesarios;
- reduzca cambios de contexto;
- haga más visible la información relevante;
- reduzca la probabilidad de error;
- facilite recuperar errores;
- produzca menor fatiga durante uso prolongado.

---

# 3. FUENTES CONCEPTUALES

Las decisiones deberán alinearse con principios consolidados provenientes de disciplinas como:

- Human-Computer Interaction.
- Interaction Design.
- Human Factors.
- Cognitive Ergonomics.
- Information Architecture.
- Accessibility.
- Enterprise UX.
- Mobile UX.

Referencias conceptuales prioritarias:

- Don Norman.
- Jakob Nielsen.
- Steve Krug.
- Alan Cooper.
- Jeff Johnson.
- Steve McConnell cuando corresponda a consistencia del producto.
- Jenifer Tidwell.
- Luke Wroblewski.
- Steve Schoger / Adam Wathan.
- John Maeda.
- Edward Tufte para visualización de información.

Estándares prioritarios:

- WCAG 2.2.
- WAI-ARIA Authoring Practices.
- HTML semántico.
- Buenas prácticas contemporáneas de accesibilidad web.

Las referencias sirven como fundamento.

No deberán utilizarse como dogmas cuando entren en conflicto con evidencia de uso real.

---

# 4. JERARQUÍA DE DECISIÓN

Cuando dos principios entren en conflicto deberá aplicarse este orden:

1. Seguridad e integridad de la información.
2. Accesibilidad.
3. Prevención de errores.
4. Comprensión.
5. Eficiencia operacional.
6. Consistencia.
7. Ergonomía.
8. Responsive behavior.
9. Jerarquía visual.
10. Estética.
11. Animación y decoración.

Nunca deberá sacrificarse claridad para conseguir una interfaz visualmente atractiva.

---

# 5. MODELO DE USUARIO

Agenda Pignus posee al menos dos contextos de utilización radicalmente diferentes.

## PERFIL A — ADMINISTRADOR / OPERADOR

Dispositivo predominante:

Desktop / Notebook.

Contexto:

Uso intensivo durante aproximadamente nueve horas diarias.

Características:

- usuario recurrente;
- conocimiento creciente del sistema;
- gran cantidad de operaciones;
- multitarea;
- consulta constante;
- creación y modificación de servicios;
- planificación;
- búsqueda;
- filtrado;
- coordinación;
- necesidad de visualizar simultáneamente múltiples datos.

Prioridades:

VELOCIDAD > INFORMACIÓN > CONTROL > ESTÉTICA.

La interfaz Desktop deberá favorecer al usuario experto.

---

## PERFIL B — TÉCNICO

Dispositivo predominante:

Smartphone.

Contexto:

Uso en campo.

Puede utilizar el sistema:

- caminando;
- dentro de un vehículo estacionado;
- en exteriores;
- bajo iluminación intensa;
- con una sola mano;
- con interrupciones;
- con conectividad variable.

Prioridades:

CLARIDAD > VELOCIDAD > ACCIONES PRINCIPALES > INFORMACIÓN SECUNDARIA.

Mobile NO deberá ser simplemente la interfaz Desktop comprimida.

Deberá considerarse una experiencia operacional específica.

---

# 6. RECONOCIMIENTO SOBRE RECUERDO

El sistema deberá minimizar información que el usuario tenga que recordar.

Siempre que sea posible deberá mostrar:

- nombre del cliente;
- dirección;
- horario;
- técnico;
- estado;
- tipo de servicio;
- información contextual relevante.

Evitar depender exclusivamente de:

- IDs;
- códigos;
- colores;
- iconos sin descripción;
- información mostrada en pantallas anteriores.

El contexto necesario para tomar una decisión deberá encontrarse donde se toma esa decisión.

---

# 7. VISIBILIDAD DEL ESTADO DEL SISTEMA

Toda operación deberá producir feedback perceptible.

El usuario deberá poder distinguir claramente:

- guardando;
- guardado;
- sincronizando;
- error;
- sin conexión;
- información desactualizada;
- conflicto;
- operación completada.

Nunca deberá existir una situación donde el usuario dude si una acción fue registrada.

Las operaciones asíncronas deberán mostrar estado.

---

# 8. PREVENCIÓN DE ERRORES

Es preferible impedir un error antes que mostrar un mensaje después.

El sistema deberá validar preventivamente:

- campos obligatorios;
- horarios;
- fechas;
- técnicos;
- permisos;
- estados incompatibles;
- datos incompletos;
- conflictos operacionales.

Especial atención deberá prestarse a conflictos de agenda.

Si dos usuarios intentan asignar simultáneamente recursos incompatibles, el sistema deberá detectarlo antes de confirmar definitivamente la operación.

---

# 9. CONCURRENCIA

Agenda Pignus es un sistema multiusuario.

La UI deberá asumir que la información puede cambiar mientras está siendo visualizada.

Nunca deberá asumirse que los datos cargados inicialmente siguen siendo válidos al guardar.

Ante modificaciones concurrentes deberá:

1. detectar el conflicto;
2. explicar qué ocurrió;
3. identificar qué información cambió;
4. evitar sobrescrituras silenciosas;
5. ofrecer una acción segura.

Ejemplo:

> Este servicio fue modificado por otro usuario mientras lo estabas editando.

Siempre que sea posible mostrar:

- valor anterior;
- nuevo valor;
- usuario responsable;
- hora de modificación.

---

# 10. AGENDA COMO SUPERFICIE OPERACIONAL

La agenda constituye una de las principales superficies de trabajo.

Deberá optimizarse para responder rápidamente:

- ¿Qué servicios existen hoy?
- ¿A qué hora?
- ¿Dónde?
- ¿Quién está asignado?
- ¿Cuál es su estado?
- ¿Existen conflictos?
- ¿Qué requiere atención?
- ¿Qué cambió recientemente?

La jerarquía visual deberá permitir comprender el día con un escaneo rápido.

---

# 11. DENSIDAD DE INFORMACIÓN

Desktop deberá utilizar densidad moderada-alta.

NO utilizar:

- tarjetas gigantes;
- espacios vacíos excesivos;
- controles sobredimensionados;
- encabezados enormes;
- navegación innecesariamente espaciosa.

Una aplicación utilizada durante nueve horas debe maximizar la cantidad de información útil visible sin convertirse en una interfaz saturada.

Deberá buscarse:

INFORMATION DENSITY + VISUAL CLARITY.

No minimalismo por minimalismo.

---

# 12. PROGRESSIVE DISCLOSURE

Mostrar inicialmente lo necesario para decidir.

Mostrar información secundaria cuando sea solicitada.

Ejemplo:

Servicio:

CLIENTE
↓
HORARIO
↓
TIPO
↓
TÉCNICO
↓
ESTADO

Detalles adicionales podrán aparecer mediante:

- drawer;
- popover;
- panel lateral;
- expansión;
- vista detalle.

Evitar obligar a abandonar la agenda para consultar información sencilla.

---

# 13. PRESERVACIÓN DEL CONTEXTO

Las acciones frecuentes deberán mantener al usuario dentro de su contexto actual.

Ejemplo:

Agenda → abrir servicio → modificar → guardar.

Después de guardar, el usuario debería continuar viendo la agenda en:

- mismo día;
- misma posición;
- mismos filtros;
- mismo contexto.

Evitar:

Agenda → página → página → formulario → guardar → dashboard → volver a buscar el día.

---

# 14. NAVEGACIÓN

La navegación deberá ser:

- predecible;
- persistente;
- consistente;
- fácilmente reconocible.

Desktop deberá favorecer navegación lateral persistente cuando corresponda.

Mobile deberá favorecer las funciones relevantes para el técnico.

No mostrar navegación administrativa innecesaria al técnico.

---

# 15. JERARQUÍA VISUAL

Cada pantalla deberá poseer una acción primaria claramente identificable.

Jerarquía:

PRIMARY ACTION  
SECONDARY ACTION  
TERTIARY ACTION  
DESTRUCTIVE ACTION

Las acciones destructivas nunca deberán competir visualmente con las principales.

---

# 16. COLOR

El color deberá comunicar significado, no decorar.

Nunca utilizar únicamente color para transmitir estado.

Un estado deberá poder reconocerse mediante combinación de:

COLOR + TEXTO

y cuando sea apropiado:

COLOR + TEXTO + ICONO.

Los colores semánticos deberán mantener significado consistente en toda la aplicación.

---

# 17. CONTRASTE

Todos los elementos funcionales deberán cumplir como mínimo WCAG AA.

Se deberá evaluar:

- texto;
- iconos;
- botones;
- inputs;
- estados disabled;
- focus;
- hover;
- badges;
- información sobre fondos coloreados.

Nunca reducir contraste simplemente para conseguir una apariencia visual más “limpia”.

---

# 18. TIPOGRAFÍA

La tipografía deberá optimizar legibilidad durante sesiones prolongadas.

Máximo recomendado:

1 familia tipográfica principal.

Utilizar pesos y tamaños para establecer jerarquía.

Evitar:

- textos excesivamente pequeños;
- light fonts para información operacional;
- mayúsculas extensas;
- bajo contraste.

Los números importantes deberán poder escanearse rápidamente.

---

# 19. ESPACIADO

Utilizar un sistema consistente de spacing tokens.

Preferentemente basado en múltiplos coherentes.

Ejemplo:

4
8
12
16
24
32
48

No utilizar valores arbitrarios sin justificación.

---

# 20. COMPONENTES

Todos los componentes deberán pertenecer al Design System.

Ejemplos:

Button
Input
Select
Combobox
Checkbox
Radio
Switch
Badge
Card
Table
Modal
Drawer
Popover
Tooltip
Toast
Tabs
Calendar
DatePicker
TimePicker
Search
Filter
Pagination
Skeleton
EmptyState
ErrorState
OfflineState

No deberán existir múltiples implementaciones visuales para el mismo concepto.

---

# 21. ESTADOS DE COMPONENTES

Todo componente interactivo deberá contemplar:

DEFAULT
HOVER
FOCUS
ACTIVE
DISABLED
LOADING
ERROR
SUCCESS

Cuando corresponda:

SELECTED
WARNING
OFFLINE
SYNCING

---

# 22. FORMULARIOS

Los formularios deberán reducir carga cognitiva.

Cada campo deberá responder claramente:

¿Qué tengo que ingresar?

¿Qué formato espera?

¿Es obligatorio?

¿Qué ocurrió si existe un error?

Las etiquetas deberán permanecer visibles.

No utilizar placeholder como sustituto permanente de label.

Errores deberán mostrarse cerca del campo correspondiente.

---

# 23. AUTOCOMPLETADO

Siempre que el sistema conozca posibles valores deberá evitarse obligar al usuario a escribir información manualmente.

Utilizar:

- autocomplete;
- combobox;
- selección;
- búsqueda;
- sugerencias.

Especialmente para:

- clientes;
- técnicos;
- direcciones;
- tipos de servicio;
- estados.

---

# 24. CONFIRMACIONES

No mostrar confirmaciones para acciones triviales y reversibles.

Utilizar confirmación cuando:

- exista pérdida de información;
- sea una acción destructiva;
- afecte a terceros;
- produzca consecuencias difíciles de revertir.

Preferir UNDO cuando sea técnicamente posible.

---

# 25. MOBILE — TOUCH TARGETS

Los controles táctiles deberán poseer superficie suficiente para utilización confortable.

Objetivo recomendado:

≥44 × 44 px.

Separar adecuadamente acciones cercanas.

Acciones destructivas deberán estar espacialmente diferenciadas.

---

# 26. MOBILE — UNA MANO

Las acciones frecuentes del técnico deberán encontrarse dentro de zonas cómodamente alcanzables.

Ejemplos:

- iniciar servicio;
- navegar al cliente;
- llamar;
- actualizar estado;
- completar servicio;
- agregar observación;
- adjuntar evidencia.

Las acciones frecuentes no deberán esconderse detrás de múltiples menús.

---

# 27. MOBILE — INFORMACIÓN PRIORITARIA

La pantalla principal del técnico deberá priorizar:

PRÓXIMO SERVICIO

Cliente  
Hora  
Dirección  
Tipo de trabajo  
Estado

Acciones directas:

NAVEGAR  
LLAMAR  
VER DETALLE  
INICIAR

Luego:

SIGUIENTES SERVICIOS.

El técnico no necesita inicialmente la misma densidad informativa que el administrador.

---

# 28. CONECTIVIDAD

Mobile deberá contemplar conectividad deficiente.

La UI deberá diferenciar claramente:

ONLINE
OFFLINE
SYNCING
SYNC FAILED

Nunca hacer creer que una operación se guardó si todavía no fue confirmada por el servidor.

---

# 29. FEEDBACK

Las acciones deberán proporcionar feedback inmediato.

Objetivo perceptual:

<100 ms → sensación inmediata.

Cuando una operación demore:

mostrar loading contextual.

Evitar bloquear toda la aplicación por operaciones locales.

---

# 30. SKELETONS

Cuando corresponda, preferir skeleton loading frente a pantallas completamente vacías con spinner.

El skeleton deberá representar aproximadamente la estructura que aparecerá.

---

# 31. EMPTY STATES

Nunca mostrar simplemente una pantalla vacía.

Explicar:

- qué significa;
- por qué puede estar vacía;
- qué puede hacer el usuario.

Ejemplo:

“No hay servicios programados para hoy.”

---

# 32. ERRORES

Un error deberá explicar:

QUÉ PASÓ.

POR QUÉ, cuando sea conocido.

QUÉ PUEDE HACER EL USUARIO.

Evitar mensajes como:

"Error 500"

"Something went wrong"

"Invalid request"

salvo información técnica secundaria.

---

# 33. TOOLTIPS

Tooltip deberá complementar, nunca sustituir información esencial.

No depender de hover para información necesaria, especialmente considerando dispositivos táctiles.

---

# 34. ICONOGRAFÍA

Los iconos deberán ser:

- consistentes;
- reconocibles;
- simples.

Acciones ambiguas deberán acompañarse con texto.

No inventar iconografía cuando exista un patrón universal reconocido.

---

# 35. MOTION

Las animaciones deberán explicar:

- transición;
- relación espacial;
- apertura;
- cierre;
- cambio de estado.

Duraciones preferentemente cortas.

Evitar animaciones decorativas durante operaciones frecuentes.

Respetar `prefers-reduced-motion`.

---

# 36. SCROLL

Evitar scroll innecesario.

En Desktop, información crítica deberá permanecer visible cuando sea posible.

Utilizar sticky headers y regiones persistentes cuando aporten contexto.

---

# 37. TABLAS

Las tablas deberán favorecer:

- scanning;
- sorting;
- filtering;
- searching;
- comparación.

Mantener encabezados visibles cuando exista scroll significativo.

Los números deberán alinearse consistentemente.

Acciones de fila deberán ser predecibles.

---

# 38. FILTROS

Los filtros activos deberán permanecer visibles.

El usuario deberá saber inmediatamente que está viendo un subconjunto de datos.

Deberá existir una acción clara:

LIMPIAR FILTROS.

Cuando corresponda, conservar filtros durante navegación contextual.

---

# 39. BÚSQUEDA

La búsqueda deberá tolerar variaciones razonables.

Cuando sea posible buscar por:

- cliente;
- dirección;
- técnico;
- teléfono;
- identificador;
- información operacional relevante.

---

# 40. RESPONSIVE DESIGN

No implementar Responsive mediante simple reducción proporcional.

Desktop y Mobile deberán compartir:

DATOS
LÓGICA
DESIGN TOKENS
IDENTIDAD

pero podrán utilizar:

DISTINTA COMPOSICIÓN
DISTINTA NAVEGACIÓN
DISTINTA DENSIDAD
DISTINTA PRIORIZACIÓN.

---

# 41. DESKTOP

Desktop deberá optimizarse para:

- mouse;
- teclado;
- multitarea;
- información simultánea;
- filtros;
- tablas;
- agenda;
- acciones rápidas.

---

# 42. KEYBOARD FIRST

Las acciones administrativas frecuentes deberán poder realizarse mediante teclado cuando sea razonable.

Considerar shortcuts para acciones repetitivas.

Ejemplo conceptual:

N → Nuevo servicio  
/ → Buscar  
ESC → Cerrar modal/drawer

Los shortcuts nunca deberán interferir con inputs.

---

# 43. FOCUS MANAGEMENT

Todos los componentes interactivos deberán poseer focus visible.

Modales y drawers deberán administrar correctamente el focus.

Al cerrarlos deberá devolverse el focus al elemento que los abrió.

---

# 44. FATIGA VISUAL

Debido al uso prolongado:

evitar:

- blanco extremo en grandes superficies cuando resulte fatigante;
- contraste excesivamente agresivo;
- colores saturados constantes;
- animaciones repetitivas;
- interfaces excesivamente fragmentadas.

El diseño deberá permanecer confortable después de varias horas.

---

# 45. DARK MODE

Dark Mode podrá implementarse si mantiene:

- contraste;
- jerarquía;
- legibilidad;
- significado semántico.

No deberá consistir simplemente en invertir colores.

Los tokens deberán poseer variantes semánticas.

---

# 46. DESIGN TOKENS

No utilizar valores visuales dispersos.

Definir tokens para:

COLOR
TYPOGRAPHY
SPACING
RADIUS
SHADOW
BORDER
Z-INDEX
MOTION
BREAKPOINTS

Ejemplo:

color.background.primary  
color.background.secondary  
color.text.primary  
color.text.secondary  
color.status.success  
color.status.warning  
color.status.danger

---

# 47. CONSISTENCIA

Una misma acción deberá:

verse igual;

llamarse igual;

comportarse igual.

Si "Guardar" confirma una modificación, no utilizar "Aplicar", "Aceptar", "Confirmar" y "Actualizar" arbitrariamente para la misma operación.

---

# 48. PERMISOS

La interfaz deberá reflejar permisos reales.

No mostrar acciones que el usuario nunca puede realizar, salvo que exista una razón UX específica para mostrar disponibilidad bloqueada.

La seguridad real siempre deberá ser validada por backend.

Ocultar un botón NO constituye autorización.

---

# 49. AUDITORÍA

Las operaciones relevantes deberán permitir comprender:

qué ocurrió;

quién lo hizo;

cuándo ocurrió.

Especialmente para cambios de:

- servicio;
- horario;
- técnico;
- estado;
- información crítica.

---

# 50. DESIGN SYSTEM

Antes de rediseñar pantallas deberán definirse:

FOUNDATIONS

Typography  
Color  
Spacing  
Grid  
Radius  
Elevation  
Motion  
Breakpoints

COMPONENTS

Buttons  
Inputs  
Selectors  
Navigation  
Cards  
Tables  
Dialogs  
Drawers  
Notifications  
Calendar components

PATTERNS

Forms  
Search  
Filters  
Scheduling  
Conflict resolution  
Confirmation  
Errors  
Loading  
Empty states  
Offline states

Las pantallas deberán construirse utilizando estos elementos.

---

# 51. PROHIBICIONES

No introducir:

- glassmorphism decorativo;
- gradients innecesarios;
- sombras excesivas;
- animaciones largas;
- tarjetas para absolutamente todo;
- iconos ambiguos sin texto;
- hamburguesas innecesarias en Desktop;
- navegación oculta sin justificación;
- tipografías diminutas;
- contrastes insuficientes;
- componentes inconsistentes;
- confirmaciones constantes;
- modales dentro de modales;
- scroll horizontal accidental;
- información importante únicamente mediante hover;
- colores sin significado;
- whitespace excesivo;
- interfaces diseñadas exclusivamente para parecer modernas.

---

# 52. REGLA DE LOS TRES SEGUNDOS

En las principales superficies operativas, un usuario experimentado debería poder identificar aproximadamente en tres segundos:

DÓNDE ESTOY.

QUÉ ESTÁ PASANDO.

QUÉ REQUIERE ATENCIÓN.

QUÉ PUEDO HACER.

Si no puede hacerlo, deberá revisarse la jerarquía visual.

---

# 53. REGLA DE FRECUENCIA

Cuanto más frecuente sea una acción:

más visible;

más accesible;

más rápida deberá ser.

Cuanto menos frecuente sea:

más puede utilizar progressive disclosure.

---

# 54. REGLA DE INTERRUPCIÓN

La aplicación deberá asumir que los usuarios son interrumpidos.

Al regresar deberán poder reconstruir rápidamente:

dónde estaban;

qué estaban haciendo;

qué información habían seleccionado.

No perder contexto innecesariamente.

---

# 55. QUALITY SCORE

Toda pantalla importante deberá evaluarse sobre 100 puntos.

Usabilidad: 20

Accesibilidad: 20

Eficiencia operacional: 15

Arquitectura de información: 10

Prevención de errores: 10

Consistencia: 10

Jerarquía visual: 5

Responsive: 5

Feedback del sistema: 5

TOTAL: 100.

---

# 56. QUALITY GATE

Una pantalla NO se considera aprobada para producción si:

UX Quality Score < 90.

Además deberá cumplir:

Accessibility ≥ 90%.

0 errores críticos de accesibilidad.

0 acciones críticas inaccesibles mediante teclado en Desktop.

0 acciones críticas inaccesibles mediante touch en Mobile.

0 pérdida silenciosa de información.

0 sobrescrituras concurrentes silenciosas.

0 errores de contraste críticos.

---

# 57. PROCEDIMIENTO OBLIGATORIO DE DISEÑO

Antes de diseñar una pantalla:

1. Identificar usuario.
2. Identificar dispositivo.
3. Identificar objetivo.
4. Identificar frecuencia de utilización.
5. Identificar información necesaria.
6. Identificar acción primaria.
7. Identificar riesgos.
8. Identificar posibles errores.
9. Identificar estados.
10. Identificar comportamiento responsive.

Luego:

11. Definir arquitectura de información.
12. Crear wireframe.
13. Evaluar flujo.
14. Aplicar Design System.
15. Crear UI.
16. Evaluar accesibilidad.
17. Evaluar UX Quality Score.
18. Corregir.
19. Reevaluar.

Sólo después podrá considerarse aprobada.

---

# 58. JUSTIFICACIÓN DE DECISIONES

Las decisiones UX relevantes deberán poder justificarse.

Formato:

DECISION

Problema.

Contexto.

Alternativas consideradas.

Solución seleccionada.

Principios UX aplicados.

Beneficios.

Riesgos.

Mitigaciones.

No justificar decisiones mediante:

“se ve mejor”

“es moderno”

“es tendencia”

“queda más limpio”.

---

# 59. EVIDENCIA SOBRE PREFERENCIA

Cuando exista evidencia proveniente de:

- pruebas de usuarios;
- métricas;
- errores recurrentes;
- tiempos de operación;
- soporte;
- comportamiento real;

esa evidencia tendrá prioridad sobre preferencias estéticas.

---

# 60. REGLA DE NO REGRESIÓN

Un rediseño visual nunca deberá empeorar una tarea existente.

Antes de modificar una superficie deberán registrarse:

- tareas disponibles;
- acciones;
- información mostrada;
- estados;
- permisos;
- comportamiento;
- casos límite.

Después del rediseño deberán verificarse nuevamente.

Una interfaz visualmente superior que elimine funcionalidad constituye una regresión.

---

# 61. PRINCIPIO FINAL

Agenda Pignus deberá sentirse:

RÁPIDA.

PREDECIBLE.

DENSA PERO ORDENADA.

PROFESIONAL.

SILENCIOSA.

CONFIABLE.

EFICIENTE.

La interfaz deberá desaparecer progresivamente de la atención del usuario.

El objetivo no es que después de nueve horas el usuario piense:

> "Qué linda interfaz."

El objetivo es que pueda trabajar durante nueve horas pensando lo menos posible en la interfaz.

---

# DIRECTIVA PARA AGENTES DE IA

Esta Constitución constituye una restricción de diseño, no una sugerencia.

Antes de generar, modificar o recomendar cualquier interfaz de Agenda Pignus:

1. Leer íntegramente esta Constitución.
2. Analizar la funcionalidad existente.
3. Identificar el perfil de usuario afectado.
4. No asumir que Desktop y Mobile requieren la misma solución.
5. No modificar lógica de negocio durante trabajos exclusivamente UX/UI.
6. No modificar contratos API.
7. No modificar modelos de datos.
8. No modificar autenticación.
9. No modificar autorización.
10. No modificar reglas de concurrencia.
11. No eliminar funcionalidad existente.
12. No introducir nuevas dependencias sin justificarlo.
13. Documentar decisiones UX significativas.
14. Evaluar el resultado contra el Quality Gate.

Cuando una solicitud contradiga esta Constitución, señalar explícitamente la contradicción antes de implementarla.

Ante incertidumbre:

INVESTIGAR → RAZONAR → PROPONER → VALIDAR.

No improvisar patrones de interfaz arbitrariamente.

El objetivo no es generar una interfaz visualmente impresionante.

El objetivo es construir una herramienta operacional excepcional.
