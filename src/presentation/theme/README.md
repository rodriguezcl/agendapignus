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

## Navegación lateral

`domain/access/navigation.mjs` define el orden compartido por la aplicación y la
vista previa de roles; los nombres de módulos provienen del catálogo de permisos.
Resumen general queda como acceso directo. Operación y Clientes y cobranzas
mantienen sus accesos visibles. Recursos reúne Colaboradores, Flota y Tipos de
servicio; Administración reúne Configuración y Auditoría. Estos dos grupos son
desplegables, sin niveles adicionales. Centro de ayuda permanece al pie.

`SidebarNavigation` recibe únicamente los módulos autorizados por la aplicación.
Los grupos vacíos desaparecen y un grupo desplegable con un solo acceso se
presenta como botón directo. El navegador recuerda por usuario los grupos
abiertos; cambiar al módulo de un grupo lo abre automáticamente. En modo compacto,
activar un grupo expande la barra. Las acciones de navegación siguen pasando
por las protecciones de formularios sin guardar. El portal técnico conserva su
navegación propia.

La verificación integrada se ejecuta con
`node scripts/verify-sidebar-navigation.cjs` y Playwright disponible en `NODE_PATH`.
Monta `App` con datos sintéticos y todas las solicitudes interceptadas.

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

## Gráficos del Resumen general

El selector de mes es común a los gráficos y a los detalles. La primera fila
distribuye proyección neta y composición en proporción 55/45; la evolución anual
ocupa el ancho de la segunda fila. En pantallas angostas las tarjetas se apilan.
Los detalles de altas por ubicación y retiros quedan debajo de los gráficos.
Esta composición reemplaza las cuatro tarjetas superiores y el bloque de
acumulado anual, evitando repetir cifras y abrir modales para leer los gráficos.
Las acciones Ver, Excel y PDF conservan sus permisos de detalle y exportación.

La proyección distingue el acumulado confirmado mediante línea continua y el
tramo estimado mediante línea punteada. La estimación utiliza el promedio neto
por día de lunes a viernes: no representa una meta. Un mes cerrado presenta el
resultado real; un mes futuro no presenta una proyección. Los resultados
negativos y la ausencia de datos deben conservar una representación explícita.

La composición muestra una dona y una leyenda con cantidades y porcentajes.
Su denominador es la suma de prestaciones representadas. Un registro multiservicio
puede aportar varios tipos de prestación, por lo que ese total puede diferir de
la cantidad de trabajos completados; la interfaz distingue ambas cantidades.

Se conserva SVG declarativo en React, siguiendo el precedente de
`AnnualEvolutionChart`. No se agregan dependencias para estos tres gráficos.
Los datos se calculan en modelos separados de la presentación, y los componentes
usan los tokens del tema junto con alternativas textuales, foco visible y
movimiento reducido. No se reordenan tarjetas ni se crean gráficos o modales
mediante búsquedas globales del DOM.

La revisión de documentación oficial del 20/10/2026 tomó estas referencias:

- [Tarjetas de AdminLTE 4](https://www.adminlte.io/themes/v4/docs/components/card.html):
  jerarquía de encabezado, contenido y pie como contenedor de cada gráfico.
- [Integraciones recomendadas](https://www.adminlte.io/themes/v4/docs/integrations.html)
  e [introducción de AdminLTE 4](https://docs.adminlte.io/html/introduction):
  la versión 4.10 utiliza Chart.js con licencia MIT y carga gráficos sólo donde
  se necesitan; reemplazó ApexCharts tras su cambio de licencia. El template
  mantiene estas bibliotecas como integraciones opcionales.
- [Tema de los gráficos](https://www.adminlte.io/themes/v4/docs/recipes.html):
  textos, ejes, leyendas y ayudas deben responder al cambio de tema.
- [Accesibilidad de Chart.js](https://www.chartjs.org/docs/latest/general/accessibility.html):
  una biblioteca de gráficos no sustituye las etiquetas y alternativas textuales.
  Mantener SVG con contenido HTML equivalente evita sumar un segundo motor para
  las series pequeñas que necesita este tablero.

La validación integrada se ejecuta con `node scripts/verify-dashboard-overview.cjs`
y Playwright disponible en `NODE_PATH`. Usa registros sintéticos, bloquea la red
y comprueba estados mensuales, totales, permisos, teclado, tacto y composición
responsive en ambos temas. Guarda capturas y resultados en
`tmp/visual-qa/dashboard-overview/`.
