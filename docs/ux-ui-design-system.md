# Sistema de diseño UX/UI de Agenda Pignus

## Alcance

Esta capa traduce la Constitución UX/UI a fundamentos reutilizables sin modificar reglas de negocio, contratos API, datos, autenticación, autorización ni concurrencia. La fuente ejecutable es `src/constitution-ui.css`, cargada al final de los estilos de la aplicación.

## Fundamentos vigentes

- Tipografía: una familia principal y escalas `xs`, `sm`, `md` y `lg`, con alturas de línea compacta y de lectura.
- Color: tokens semánticos para marca, superficies, texto, bordes, información, advertencia, peligro y éxito.
- Espaciado: escala única de 4, 8, 12, 16, 24, 32 y 48 píxeles.
- Radios: `sm`, `md`, `lg` y `pill` según jerarquía del componente.
- Elevación: tarjeta, elemento flotante y modal.
- Interacción: control base de 42 píxeles y objetivo táctil de 44 píxeles.
- Movimiento: duraciones corta y normal, con anulación mediante `prefers-reduced-motion`.
- Capas: niveles documentados para contenido fijo y modal.
- Breakpoints: móvil en 640 píxeles y tablet en 900 píxeles. CSS no permite usar variables personalizadas dentro de `@media`; los tokens documentan los valores canónicos.

## Componentes normalizados

Botones, campos, modales, tarjetas, tablas y etiquetas de estado consumen los tokens constitucionales. Los estados `disabled` y `loading` diferencian el cursor y evitan movimiento. Los estados completado y cancelado usan texto además de color.

### Estados y feedback

`SystemState` es el patrón común para `loading`, `syncing`, `empty`, `warning`, `error`, `offline` y `success`. Cada estado combina texto, semántica ARIA e iconografía; los estados de espera representan la estructura mediante skeleton y respetan movimiento reducido.

Las notificaciones operativas se clasifican visual y semánticamente a partir del resultado comunicado. Un fallo usa `role="alert"`; una confirmación o advertencia no urgente usa `role="status"`. Todas conservan texto visible, por lo que el color nunca es el único indicador.

## Compatibilidad y migración

La capa anterior usa variables `--ui-*`. Durante la migración, esas variables funcionan como alias de `--pignus-*`. No se eliminarán hasta que cada módulo deje de consumirlas y supere las pruebas de no regresión.

Los estilos históricos conservan reglas específicas necesarias para sus composiciones. La migración será gradual: primero tokens y componentes de alta frecuencia; luego patrones y módulos. No se realizará una sustitución masiva de valores ni de `!important` sin una comprobación visual y funcional por superficie.

## Decisión UX

**Problema.** Existen valores visuales repetidos y dos convenciones de variables, lo que facilita divergencias entre módulos.

**Alternativas consideradas.** Reescritura completa de las hojas existentes; mantenimiento sin cambios; capa constitucional compatible y migración progresiva.

**Solución seleccionada.** Centralizar fundamentos y componentes frecuentes en una capa final, manteniendo alias temporales.

**Principios aplicados.** Consistencia, prevención de regresiones, accesibilidad, ergonomía y eficiencia operacional.

**Beneficios.** Una fuente canónica para nuevas decisiones, temas semánticos coherentes y menor costo de migración.

**Riesgos.** La cascada histórica puede conservar excepciones o sobrescribir tokens.

**Mitigaciones.** Selectores de baja especificidad, pruebas estructurales, compilación, revisión del diff y migración por etapas.

## Quality Gate de esta etapa

- Acciones críticas conservadas: sí.
- Contratos y lógica operativa modificados: no.
- Foco visible y objetivos táctiles: conservados.
- Estados semánticos sólo por color: no; mantienen texto visible.
- Movimiento reducido: conservado.
- Validación requerida: build, pruebas UX y pruebas operativas existentes.
