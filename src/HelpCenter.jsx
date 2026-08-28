import React, { useMemo, useState } from 'react'
import Icon from './components/ui/Icon.jsx'
import './help-center.css'

const MODULES = [
  {
    id: 'start', module: 'dashboard', icon: 'dashboard', title: 'Primeros pasos', summary: 'Conocé el recorrido completo desde la planificación hasta el cierre del servicio.',
    articles: [
      { title: 'Recorrido recomendado', intro: 'Para mantener la información ordenada, conviene trabajar en este orden:', steps: ['Revisá que el abonado o cliente exista y que sus datos estén actualizados.', 'Planificá equipos y servicios desde Agenda semanal. Si la fecha es feriado, definí primero si será laboral o no operativa.', 'Abrí la fecha en Agenda del día para completar o ajustar la planificación.', 'Guardá la agenda. Los servicios quedarán disponibles en Historial y en la agenda del técnico asignado.', 'Cuando el técnico informe el resultado, revisá el estado y sus observaciones desde Historial o desde la ficha del cliente.'] },
      { title: 'Diferencia entre PIG y CLI', body: 'Los códigos PIG identifican abonados con alarma y abono mensual. Los códigos CLI identifican clientes que recibieron un servicio pero no poseen ese abono. El código permite reconocer correctamente a la persona aunque su nombre cambie.' },
      { title: 'Qué puede hacer cada perfil', body: 'El administrador configura el sistema y puede definir feriados, permisos y accesos. Los perfiles de planificación trabajan con agendas, clientes e historial según los permisos asignados. El técnico ve sus servicios, informa el resultado, consulta su historial y accede en modo lectura al historial del cliente.' },
      { title: 'Antes de guardar', body: 'Confirmá fecha, equipo, técnicos, horario, tipo de servicio y cliente. Dirección y contacto deben estar completos en la ficha del cliente. En una instalación de alarma también es obligatorio indicar la ubicación de la instalación.' },
      { title: 'Campos obligatorios', body: 'El asterisco rojo aparece después del nombre del campo e indica que debe completarse antes de guardar. Los campos adicionales cambian según el tipo de servicio para evitar pedir información que no corresponde.' }
    ]
  },
  {
    id: 'dashboard', module: 'dashboard', icon: 'dashboard', title: 'Menú principal', summary: 'Interpretá los indicadores de altas, bajas, crecimiento y trabajos realizados.',
    articles: [
      { title: 'Qué muestran los indicadores', body: 'Las estadísticas consideran únicamente servicios completados del mes elegido. Altas de servicio cuenta instalaciones de alarmas; Bajas de servicio cuenta retiros; Proyección neta de abonados resta las bajas a las altas; Trabajos completados incluye instalaciones y servicios técnicos.' },
      { title: 'Abrir el detalle', body: 'Presioná las tarjetas de Altas o Bajas para consultar los registros que forman el total del período seleccionado.' },
      { title: 'Acumulado anual', body: 'Las cuatro tarjetas anuales muestran desde el 1 de enero hasta el día actual las instalaciones completadas en Docta, Nobu Town y Residenciales, además de las bajas de servicio. No es necesario sumar los meses manualmente.' },
      { title: 'Evolución anual', body: 'El gráfico muestra solamente los meses transcurridos del año y separa Docta, Nobu Town, Residenciales y Bajas por color. En pantallas pequeñas se adapta para conservar la lectura de valores y referencias.' },
      { title: 'Descargar reportes para Gerencia', body: 'En el detalle por ubicación y en Bajas de servicio podés descargar Excel o PDF. Los archivos incluyen los registros ordenados por fecha y funcionan tanto en computadora como en smartphone.' },
      { title: 'Servicios pendientes', body: 'El aviso amarillo indica trabajos que todavía necesitan una definición. Ingresá a Historial para completarlos, cancelarlos o reprogramarlos.' }
    ]
  },
  {
    id: 'weekly', module: 'weekly', icon: 'calendar', title: 'Agenda semanal', summary: 'Planificá la semana, asigná técnicos y administrá servicios por equipo.',
    articles: [
      { title: 'Elegir la semana', body: 'Seleccioná una fecha en Semana de trabajo. La vista se posiciona en el día actual cuando corresponde, pero las barras superior e inferior permiten consultar días anteriores y posteriores.' },
      { title: 'Definir equipos y horarios del mes', body: 'Al comenzar un mes, un administrador debe confirmar la composición desde Equipos del mes y luego establecer dos turnos desde Horarios del mes. El sistema propone la configuración anterior para facilitar la carga. Los horarios se aplican a los espacios vacíos del mes; los servicios ya cargados conservan su hora.' },
      { title: 'Trabajar en un feriado nacional', body: 'El sistema verifica automáticamente el calendario de feriados antes de habilitar servicios. En un feriado, un administrador debe elegir Día laboral para habilitar la agenda o Día no operativo para bloquearla. La decisión queda compartida con los demás usuarios y puede modificarse sin borrar los servicios existentes.', note: 'Si la verificación del calendario no está disponible, la agenda permanece bloqueada por seguridad y muestra la opción Reintentar.' },
      { title: 'Asignar técnicos', steps: ['Buscá el día y el equipo.', 'Presioná el botón con la silueta de una persona y el signo +.', 'Marcá los técnicos que formarán el equipo.', 'Cerrá el selector. Los nombres aparecerán debajo del título del equipo.'] },
      { title: 'Agregar o editar un servicio', steps: ['Presioná Agregar servicio o seleccioná un horario disponible.', 'Elegí hora y tipo de servicio.', 'Si elegís Instalación de alarma, indicá primero la ubicación de la instalación.', 'Buscá el cliente por nombre o código.', 'Revisá dirección y contacto, completá el detalle y guardá.'], note: 'Los servicios se ordenan automáticamente por horario. Si agregás uno más temprano, pasará a ocupar el primer lugar.' },
      { title: 'Guardar servicios cargados', body: 'El botón Guardar registra únicamente los servicios que tienen completos sus campos obligatorios y un técnico asignado. Los horarios disponibles y las tarjetas incompletas no bloquean la acción: permanecen en la planificación para completarlos y guardarlos más adelante.' },
      { title: 'Campos adicionales según el servicio', body: 'Forma de pago, Monto, Abono mensual y Formulario se habilitan solamente cuando corresponden al tipo de servicio. Forma de pago permite Efectivo, Transferencia, Débito, Crédito, A confirmar o No aplica. Monto aparece al elegir una forma de pago y es obligatorio salvo con A confirmar; con No aplica no se solicita. En Instalación de alarma, el abono mensual se habilita únicamente para una instalación Residencial. Formulario ofrece Completo o Incompleto (Abonado completa a mano), tanto en Instalación de alarma como en Cambio de titularidad.' },
      { title: 'Eliminar o mover un servicio', body: 'Usá el botón rojo del servicio para eliminarlo. Para cambiarlo de equipo sin volver a cargar sus datos, utilizá el botón de traslado y elegí el equipo de destino.' },
      { title: 'Guardia del sábado', body: 'Los sábados se prepara un solo equipo y el técnico se elige manualmente porque la guardia es rotativa. Si ese técnico recibe un servicio el viernes entre las 16:00 y las 20:00, el sistema interpreta que adelantó su guardia: bloquea cualquier nuevo equipo, técnico o servicio del sábado y muestra una leyenda informativa.' },
      { title: 'Conflicto de guardia adelantada', body: 'Si el sábado ya tenía un servicio real cuando se detecta la guardia adelantada del viernes, el sistema no lo elimina. Muestra una advertencia para que Administración revise el conflicto y decida cómo resolverlo.' },
      { title: 'Servicios reprogramados y estados', body: 'Una reprogramación confirmada desde Historial se incorpora al nuevo día y conserva cliente, servicio, horario, equipo y técnicos. En Agenda semanal, cada tarjeta muestra su estado vigente —Pendiente, Completado, Cancelado, Reprogramado o Requiere revisión— junto al tipo de servicio con el mismo color utilizado en Historial, sin necesidad de abrir el trabajo. No reemplaza otros trabajos, salvo que encuentre el mismo cliente en el mismo equipo y horario.' }
    ]
  },
  {
    id: 'daily', module: 'agenda', icon: 'agenda', title: 'Agenda del día', summary: 'Terminá de organizar la jornada y guardá el registro de cada servicio.',
    articles: [
      { title: 'Cargar la agenda de una fecha', body: 'Elegí la fecha de trabajo. La agenda carga la planificación semanal y los servicios reprogramados de ese día. Podés agregar trabajos de último momento sin perder los ya registrados. Si es feriado, primero debe existir una definición de Día laboral.' },
      { title: 'Completar un servicio', steps: ['Ingresá la hora.', 'Seleccioná el tipo de servicio.', 'Buscá y elegí el abonado o cliente.', 'Revisá dirección, contacto y observaciones.', 'Si es una instalación de alarma, elegí la ubicación y completá los datos adicionales habilitados.'], note: 'En la vista previa no se muestran Forma de pago, Abono mensual o Formulario cuando no aplican al servicio.' },
      { title: 'Cliente con datos incompletos', body: 'Dirección y contacto son obligatorios para usar un cliente en las agendas. Corregilos desde Abonados y clientes antes de programar el servicio; de esa forma el dato actualizado se reutiliza en futuras agendas.' },
      { title: 'Guardar, copiar y limpiar', body: 'Guardar agenda registra los servicios para su seguimiento. Vista previa permite revisar el mensaje completo y Copiar agenda lo lleva al portapapeles para compartir toda la jornada. Limpiar agenda elimina la carga del día; usalo solamente cuando quieras comenzar nuevamente.' },
      { title: 'Copiar un solo servicio', body: 'Cada servicio tiene un botón Copiar. Usalo cuando aparezca un trabajo nuevo durante el día y necesites enviar únicamente esa información, sin repetir toda la agenda que ya fue compartida.' },
      { title: 'Mover un servicio y consultar su estado', body: 'Presioná Reasignar en el bloque de acciones del servicio y elegí otro equipo. Se conservan todos los datos y la lista vuelve a ordenarse por horario. La ficha muestra también si el servicio está Pendiente, Completado, Cancelado, Reprogramado o Requiere revisión.' }
    ]
  },
  {
    id: 'history', module: 'history', icon: 'history', title: 'Historial', summary: 'Consultá trabajos y actualizá su estado sin perder el seguimiento.',
    articles: [
      { title: 'Buscar registros', body: 'Buscá por cliente, servicio o técnico. La búsqueda no distingue mayúsculas ni tildes: “instalacion” encuentra “Instalación”.' },
      { title: 'Cómo se ordena la tabla', body: 'La tabla muestra primero todos los servicios pendientes, desde la fecha más antigua a la más nueva y, dentro de cada día, desde el horario más temprano al más tarde. Después aparecen los servicios completados y los demás estados. La columna Hora evita tener que consultar otra agenda.' },
      { title: 'Gestionar un servicio', body: 'Presioná Gestionar para ver sus datos. Desde allí podés marcarlo como completado, devolverlo a pendiente, cancelarlo, reprogramarlo, editar información permitida o eliminar el registro.' },
      { title: 'Estados disponibles', body: 'Pendiente significa que todavía requiere una definición. Completado confirma que el trabajo se realizó. Cancelado indica que no se realizará. Reprogramado mueve el servicio a otra fecha.' },
      { title: 'Reprogramar correctamente', steps: ['Abrí Gestionar.', 'Elegí una fecha futura.', 'Presioná Reprogramar.', 'Revisá la nueva fecha en Agenda semanal o Agenda del día.'], note: 'El servicio se quita del día original y se incorpora una sola vez en la fecha nueva.' },
      { title: 'Retiro de equipo', body: 'Cuando un retiro de equipo se marca como completado, representa una baja de servicio. Si el cliente era abonado PIG, su registro pasa a la condición de cliente CLI conservando su información.' },
      { title: 'Gestión múltiple', body: 'Seleccioná varios registros y presioná Gestionar selección para aplicar el mismo estado a todos. Antes de confirmar, verificá que todos deban recibir exactamente el mismo cambio.' }
    ]
  },
  {
    id: 'accounts', module: 'accounts', icon: 'accounts', title: 'Abonados y clientes', summary: 'Administrá datos comerciales y evitá registros duplicados.',
    articles: [
      { title: 'Crear un registro', body: 'Usá Nuevo cliente para cargar una persona sin abono. Código, nombre, calle o dirección y teléfono o contacto son obligatorios y están identificados con un asterisco rojo. El sistema asignará un código CLI.' },
      { title: 'Editar datos', body: 'Presioná el lápiz. Se abrirá un formulario donde podés actualizar nombre, dirección, localidad, provincia y teléfono. El nombre se guarda en mayúsculas para mantener una presentación uniforme.' },
      { title: 'Ver el historial de un cliente', body: 'Presioná Ver historial en la ficha del abonado o cliente. Se muestran todos sus servicios del más reciente al más antiguo, con fecha, hora, estado, técnicos, observación de agenda y la observación informada por el técnico.' },
      { title: 'Cómo leer una observación técnica', body: 'Cuando un técnico informa un servicio, su nota aparece identificada con su nombre, por ejemplo “Santos indicó”. Esta información ayuda a preparar futuras visitas sin confundirla con el detalle cargado por Administración.' },
      { title: 'Evitar duplicados', body: 'Antes de crear un cliente, buscalo por nombre, código o dirección. Si encontrás registros parecidos, revisá sus datos antes de continuar. No crees un CLI si la persona ya tiene un código PIG.' },
      { title: 'Eliminar un registro', body: 'Un abonado o cliente no puede eliminarse mientras tenga servicios vinculados. Esto protege su historial. Corregí o fusioná el registro correspondiente en lugar de eliminar información relacionada.' },
      { title: 'Importar abonados', body: 'Usá Importar abonados para actualizar la base de clientes PIG. Si el archivo no contiene un campo obligatorio, el sistema lo completa con “-” para mantener el registro utilizable. Revisá el archivo antes de confirmar y evitá modificar manualmente los códigos.' }
    ]
  },
  {
    id: 'technician', module: 'agenda', icon: 'users', title: 'Perfil técnico', summary: 'Informá servicios y consultá antecedentes útiles desde el teléfono o la computadora.',
    articles: [
      { title: 'Servicios asignados', body: 'Agenda técnica muestra los servicios pendientes de hoy y fechas futuras. Deben resolverse en el orden indicado: la dirección y el contacto del siguiente se habilitan después de informar el estado del servicio actual.' },
      { title: 'Marcar un servicio como completado', steps: ['Presioná Marcar completado.', 'Cargá una observación técnica si puede servir en futuras visitas.', 'Presioná Continuar.', 'Revisá el mensaje de confirmación y elegí Sí, confirmar estado.'], note: 'La observación es opcional al completar, pero es obligatoria al solicitar una reprogramación o informar una cancelación.' },
      { title: 'Consultar mi historial', body: 'Abrí Historial desde el menú del perfil técnico. La barra de búsqueda encuentra por cliente, código, servicio, fecha o detalle dentro de los trabajos que informaste.' },
      { title: 'Consultar antecedentes del cliente', body: 'Dentro de un servicio habilitado, presioná Ver historial del cliente. La consulta es de solo lectura y muestra notas de agenda y observaciones técnicas anteriores para ayudarte a preparar la visita.' },
      { title: 'Menú del técnico', body: 'En smartphone, abrí el menú desplegable con el botón de tres líneas. En una computadora, los módulos autorizados se presentan en la navegación lateral igual que en los demás perfiles.' }
    ]
  },
  {
    id: 'mobile', icon: 'menu', title: 'Uso desde smartphone', summary: 'Usá las funciones principales en una pantalla pequeña sin perder información.',
    articles: [
      { title: 'Abrir y cerrar el menú', body: 'Presioná el botón de tres líneas para mostrar los módulos y tocá fuera del panel para cerrarlo. El contenido queda bloqueado mientras el menú está abierto para evitar acciones accidentales.' },
      { title: 'Formularios y ventanas', body: 'Los campos, botones y ventanas se reorganizan automáticamente en una columna. Desplazate dentro de la ventana cuando el formulario sea largo; no es necesario alejar el zoom del navegador.' },
      { title: 'Descargar Excel o PDF', body: 'Los botones Excel y PDF generan el archivo también en smartphone. Según el navegador, la descarga puede aparecer en Descargas, Archivos o en el menú para compartir.' },
      { title: 'Crear un acceso directo', body: 'Usá la opción Agregar a pantalla de inicio del navegador. El acceso directo utiliza el ícono del búho de Agenda Pignus y abre la plataforma directamente.' },
      { title: 'Cerrar sesión', body: 'Usá Cerrar sesión cuando termines, especialmente en un dispositivo compartido. La notebook donde se desarrolló el sistema no necesita estar encendida: la aplicación funciona en Vercel y los datos se guardan en la base remota.' }
    ]
  },
  {
    id: 'employees', module: 'employees', icon: 'users', title: 'Empleados', summary: 'Gestioná colaboradores, accesos y disponibilidad.',
    articles: [
      { title: 'Crear o editar un empleado', body: 'Cargá nombre y apellido por separado, rol, teléfono y correo. El nombre completo se utiliza en los demás módulos; en vistas con poco espacio puede mostrarse solamente el nombre.' },
      { title: 'Activar o desactivar', body: 'Un empleado activo puede aparecer para asignaciones según su rol. Al desactivarlo deja de estar disponible y su sesión se cierra, pero sus trabajos anteriores permanecen registrados.' },
      { title: 'Cambiar el rol', body: 'Elegí un rol existente. Si el nombre de ese rol cambia en Configuración, se actualizará en Empleados sin perder la relación ni los permisos.' },
      { title: 'Eliminar', body: 'No elimines un empleado que tenga trabajos asignados. Primero reasigná sus servicios o desactivalo para conservar correctamente el historial.' }
    ]
  },
  {
    id: 'services', module: 'services', icon: 'tools', title: 'Tipo de servicio', summary: 'Mantené actualizado el catálogo utilizado por todas las agendas.',
    articles: [
      { title: 'Crear o editar un tipo', body: 'Definí un nombre claro y una descripción breve. Los cambios de nombre se reflejan en las opciones del sistema sin perder la identidad del servicio.' },
      { title: 'Desactivar o eliminar', body: 'Si un servicio dejó de ofrecerse, es preferible marcarlo inactivo. Los servicios usados en agendas o historial no deben eliminarse porque forman parte de registros anteriores.' },
      { title: 'Instalación de alarma', body: 'Este tipo posee requisitos especiales. Al programarlo debe indicarse la ubicación de la instalación para que las estadísticas gerenciales puedan clasificarla correctamente.' }
    ]
  },
  {
    id: 'vehicles', module: 'vehicles', icon: 'vehicle', title: 'Vehículos', summary: 'Administrá la flota y sus datos identificatorios.',
    articles: [
      { title: 'Registrar un vehículo', body: 'Presioná Nuevo vehículo y completá Marca, Modelo, Año, Kilometraje y Matrícula. La matrícula se guarda en mayúsculas y no puede repetirse.' },
      { title: 'Editar los datos', body: 'Usá el botón de edición de la fila correspondiente para corregir cualquiera de los cinco campos y guardá los cambios.' },
      { title: 'Eliminar de la flota', body: 'Usá el botón rojo de la fila y confirmá la eliminación. El registro dejará de formar parte de la flota disponible.' }
    ]
  },
  {
    id: 'settings', module: 'settings', icon: 'settings', title: 'Configuración', summary: 'Definí roles y decidí qué módulos puede utilizar cada perfil.',
    articles: [
      { title: 'Editar un rol', body: 'Podés cambiar su nombre y descripción. Los empleados vinculados conservarán el mismo rol y verán el nuevo nombre.' },
      { title: 'Asignar permisos', body: 'Activá solamente los módulos que el rol necesita para trabajar. Auditoría permanece reservada para administradores.' },
      { title: 'Antes de quitar un permiso', body: 'Confirmá que la persona ya no necesita ese módulo. El cambio puede impedirle continuar una tarea que tenía abierta.' }
    ]
  },
  {
    id: 'audit', module: 'audit', icon: 'audit', adminOnly: true, title: 'Auditoría', summary: 'Revisá quién realizó cambios importantes y qué información fue afectada.',
    articles: [
      { title: 'Consultar movimientos', body: 'Filtrá por acción o buscá un usuario, entidad o registro. Presioná Ver detalle para comparar la información anterior con la posterior. El módulo conserva y muestra únicamente los 100 movimientos más recientes para mantener un funcionamiento ágil.' },
      { title: 'Cuándo usarla', body: 'Consultá Auditoría cuando necesites saber quién creó, modificó o eliminó un dato, o cuando una agenda ya no coincida con lo esperado.' },
      { title: 'Qué no hace', body: 'Auditoría sirve para revisar movimientos; no modifica ni recupera datos por sí misma. Luego de identificar el cambio, realizá la corrección desde el módulo correspondiente.' }
    ]
  }
]

const FAQ = [
  ['¿Qué hago si marqué un servicio como completado por error?', 'Abrí el registro desde Historial y presioná Marcar pendiente. El servicio volverá a requerir una definición.'],
  ['¿Puedo agregar un servicio durante el mismo día?', 'Sí. Podés hacerlo desde Agenda del día o Agenda semanal. Se conservarán los trabajos existentes y se ordenará por horario.'],
  ['¿Qué ocurre cuando reprogramo?', 'El servicio se mueve a la nueva fecha y conserva sus datos. No queda duplicado en el día original.'],
  ['¿Cómo cambio un servicio de equipo?', 'Usá el botón de traslado del servicio y elegí el equipo de destino. No es necesario eliminarlo ni cargarlo nuevamente.'],
  ['¿Cómo comparto solamente un servicio nuevo?', 'En Agenda del día, presioná Copiar dentro de ese servicio. El portapapeles recibirá únicamente sus datos.'],
  ['¿Qué significa “No aplica” en Forma de pago?', 'Indica que ese servicio no requiere registrar un medio de pago. Al elegirlo, el campo Monto no se muestra ni se exige.'],
  ['¿Qué hago si la fecha es feriado?', 'Un administrador debe elegir Día laboral para habilitar servicios o Día no operativo para bloquear la agenda. Los demás perfiles pueden ver la decisión, pero no modificarla.'],
  ['¿Por qué el sábado dice que el técnico adelantó el servicio?', 'Ese técnico tiene un servicio el viernes entre las 16:00 y las 20:00 y el sistema lo tomó como guardia adelantada. Por eso no ofrece otro turno el sábado por la mañana.'],
  ['¿Por qué no puedo eliminar una persona, cliente o servicio?', 'El registro puede estar vinculado a trabajos anteriores. La restricción evita perder información importante; en esos casos conviene desactivarlo o corregirlo.'],
  ['¿Qué significa “cambios guardados desde otra sesión”?', 'Otra pestaña o usuario guardó información después de que abriste la pantalla. Recargá la página antes de seguir para trabajar con la versión más reciente.'],
  ['¿Cuánto tiempo permanecen los avisos verdes?', 'Los mensajes de confirmación desaparecen automáticamente después de algunos segundos. También podés cerrarlos de inmediato con la cruz.'],
  ['¿Por qué un sábado aparece sin técnico?', 'Es intencional: trabaja una sola persona y la guardia rota. Si no fue adelantada el viernes, el técnico debe seleccionarse manualmente.'],
  ['¿Dónde corrijo la dirección o el teléfono de un cliente?', 'En Abonados y clientes. Así el cambio queda disponible para las próximas agendas.'],
  ['¿Dónde veo las observaciones de visitas anteriores?', 'En Abonados y clientes, presioná Ver historial. El técnico también puede consultar esos antecedentes en modo lectura desde su servicio asignado.'],
  ['¿Por qué el técnico no ve la dirección del próximo servicio?', 'Los trabajos se habilitan en orden. Debe informar primero el estado del servicio anterior para acceder a la dirección y el contacto del siguiente.'],
  ['¿La notebook debe quedar encendida para usar Agenda Pignus?', 'No. La aplicación está publicada en Vercel y utiliza una base de datos remota, por lo que funciona aunque la notebook esté apagada.']
]

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function HelpShell({ user, onNavigate, logout, theme, setTheme, isAdministrator, navigation }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = id => { setMenuOpen(false); onNavigate(id) }
  return <div className="app-shell" data-theme={theme}>
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="brand"><span className="brand-mark">◢</span><div><strong>PIGNUS</strong><small>GUARDIANES POR NATURALEZA</small></div></div><p className="nav-label">MÓDULOS</p><nav>{navigation.map(([id, icon, label]) => <button key={id} className={id === 'help' ? 'active' : ''} onClick={() => navigate(id)}><Icon name={icon} />{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>
    {menuOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}
    <main><header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><div className="page-heading"><span>PIGNUS</span><i /><b>Centro de ayuda</b></div><div className="profile"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><span className="profile-avatar">{String(user?.name || 'U').split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase()}</span><span>{user?.name}</span><button className="logout-button" onClick={logout}><Icon name="logout" size={17} /><span>Cerrar sesión</span></button></div></header><section className="content"><HelpCenter onNavigate={onNavigate} isAdministrator={isAdministrator} /></section></main>
  </div>
}

function HelpCenter({ onNavigate, isAdministrator }) {
  const available = useMemo(() => MODULES.filter(item => isAdministrator || !item.adminOnly), [isAdministrator])
  const [query, setQuery] = useState('')
  const [active, setActive] = useState('start')
  const [open, setOpen] = useState('start-0')
  const selected = available.find(item => item.id === active) || available[0]
  const searchResults = useMemo(() => {
    const term = normalize(query).trim()
    if (!term) return []
    const moduleResults = available.flatMap(section => section.articles
      .map((article, index) => ({ ...article, section, index }))
      .filter(item => normalize(`${item.section.title} ${item.title} ${item.intro || ''} ${item.body || ''} ${(item.steps || []).join(' ')} ${item.note || ''}`).includes(term)))
    const faqSection = { id: 'faq', icon: 'help', title: 'Preguntas frecuentes' }
    const faqResults = FAQ
      .map(([title, body], index) => ({ title, body, section: faqSection, index }))
      .filter(item => normalize(`${item.title} ${item.body}`).includes(term))
    return [...moduleResults, ...faqResults]
  }, [available, query])
  const choose = (sectionId, articleIndex = 0) => { setActive(sectionId); setOpen(`${sectionId}-${articleIndex}`); setQuery('') }
  const visibleArticles = selected?.articles || []
  return <div className="help-center">
    <header className="help-hero">
      <div><p className="eyebrow">GUÍAS Y PREGUNTAS FRECUENTES</p><h1>Centro de ayuda</h1><span className="help-updated">Actualizado · 28 de agosto de 2026</span><p>Encontrá instrucciones simples para completar cada tarea con seguridad.</p></div>
      <label className="help-search"><Icon name="search" size={19} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="¿Qué necesitás hacer?" autoComplete="off" />{query && <button onClick={() => setQuery('')} aria-label="Limpiar búsqueda"><Icon name="close" size={15} /></button>}</label>
    </header>
    {query ? <section className="help-results data-card"><div className="help-section-title"><div><span>{searchResults.length}</span><h2>Resultados para “{query}”</h2></div></div>{searchResults.length ? searchResults.map(result => <button className="help-result" key={`${result.section.id}-${result.index}`} onClick={() => choose(result.section.id, result.index)}><Icon name={result.section.icon} /><span><b>{result.title}</b><small>{result.section.title}</small></span><i>Ver respuesta →</i></button>) : <div className="help-empty"><Icon name="search" size={30} /><h3>No encontramos una respuesta con esas palabras</h3><p>Probá con términos como “feriado”, “guardia”, “cliente”, “técnico” o “copiar”.</p></div>}</section> : <div className="help-layout">
      <aside className="help-categories data-card"><h2>Temas de ayuda</h2>{available.map(item => <button className={item.id === selected?.id ? 'active' : ''} key={item.id} onClick={() => { setActive(item.id); setOpen(`${item.id}-0`) }}><span><Icon name={item.icon} /></span><div><b>{item.title}</b><small>{item.summary}</small></div></button>)}<button className={active === 'faq' ? 'active' : ''} onClick={() => { setActive('faq'); setOpen('faq-0') }}><span><Icon name="help" /></span><div><b>Preguntas frecuentes</b><small>Respuestas rápidas para situaciones habituales.</small></div></button></aside>
      <main className="help-content data-card">{active === 'faq' ? <><div className="help-section-title"><div><span><Icon name="help" /></span><div><p className="eyebrow">RESPUESTAS RÁPIDAS</p><h2>Preguntas frecuentes</h2></div></div></div><div className="help-articles">{FAQ.map(([question, answer], index) => <HelpArticle key={question} id={`faq-${index}`} title={question} body={answer} open={open} setOpen={setOpen} />)}</div></> : <><div className="help-section-title"><div><span><Icon name={selected.icon} /></span><div><p className="eyebrow">GUÍA DEL MÓDULO</p><h2>{selected.title}</h2><p>{selected.summary}</p></div></div>{selected.module && <button className="secondary" onClick={() => onNavigate(selected.module)}>Ir al módulo <span>→</span></button>}</div><div className="help-articles">{visibleArticles.map((article, index) => <HelpArticle key={article.title} id={`${selected.id}-${index}`} {...article} open={open} setOpen={setOpen} />)}</div></>}</main>
    </div>}
    <section className="help-tip"><span>i</span><div><b>Consejo</b><p>Si una acción puede modificar o eliminar información, leé el mensaje de confirmación antes de continuar. El sistema explica qué datos serán afectados.</p></div></section>
  </div>
}

function HelpArticle({ id, title, intro, body, steps, note, open, setOpen }) {
  const expanded = open === id
  return <article className={expanded ? 'open' : ''}><button onClick={() => setOpen(expanded ? '' : id)} aria-expanded={expanded}><span>{title}</span><i>{expanded ? '−' : '+'}</i></button>{expanded && <div className="help-answer">{intro && <p>{intro}</p>}{body && <p>{body}</p>}{steps && <ol>{steps.map(step => <li key={step}>{step}</li>)}</ol>}{note && <div className="help-note"><b>Importante</b><span>{note}</span></div>}</div>}</article>
}
