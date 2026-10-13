# Tema de administración

Adaptación visual inspirada en AdminLTE 4 sobre los componentes React existentes.
No agrega Bootstrap ni plugins que manejen el DOM o dupliquen la navegación.

La entrada `main.jsx` carga estas capas después de los estilos heredados:

1. `tokens.css`: paletas clara y oscura, medidas y equivalencias con los tokens anteriores.
2. `shell.css`: navegación, barra superior, ingreso y estructura de página.
3. `modules.css`: tarjetas, agenda, listados, indicadores, configuración y ayuda.
4. `forms.css`: controles, formularios, desplegables y diálogos.

Los componentes nuevos deben usar `--ap-surface`, `--ap-surface-alt`, `--ap-border`,
`--ap-text` y `--ap-muted`, evitando colores de fondo fijos. `--ap-accent-ink`
es el texto sobre un fondo **sólido** `--ap-accent`; sobre `--ap-accent-soft`
corresponde `--ap-accent`. Los colores de estados, equipos y del check de
servicio listo mantienen su significado.

El tema se define tanto en la raíz de la aplicación como en `body` para que los
diálogos montados con portales hereden la misma paleta. Las reglas `!important`
de compatibilidad sustituyen colores de los módulos heredados; no deben usarse
como patrón para componentes nuevos.

Validación visual reproducible: `node scripts/verify-admin-theme.cjs`, con
Playwright disponible en `NODE_PATH` y Microsoft Edge instalado. Usa datos de
prueba locales y bloquea solicitudes externas. Las capturas quedan en
`tmp/visual-qa/theme-review/` y no se versionan.

Los controles nuevos de la cabecera se verifican montando `App` completo con
`node scripts/verify-admin-chrome.cjs`: menú compacto persistente, navegación,
drawer móvil, temas, pantalla completa y campana. La API de pantalla completa
también tiene una prueba aislada: `node scripts/verify-fullscreen-toggle.cjs`.

La campana muestra avisos activos, sin un estado independiente de leído/no leído.
`dashboard-notifications.mjs` comparte los criterios del tablero y restringe los
destinos según permisos. Las solicitudes de contraseña se consultan una sola vez
desde `usePasswordResetRequests`, únicamente para administradores, y alimentan
tanto el tablero como la campana. Abrir un aviso no modifica datos operativos.

`AnnualEvolutionChart` representa las cuatro series mensuales con curvas y áreas
independientes en SVG, sin dependencias adicionales. Su modelo conserva las
clasificaciones del tablero, limita los meses al período transcurrido y calcula
una escala de cantidades enteras desde cero. Incluye valores al pasar el cursor,
tocar o enfocar un mes, una leyenda seleccionable y una tabla para lectores de
pantalla. `node scripts/verify-annual-evolution.cjs` revisa ambos temas y tamaños
de pantalla con datos sintéticos; las capturas quedan en
`tmp/visual-qa/annual-evolution/`.
