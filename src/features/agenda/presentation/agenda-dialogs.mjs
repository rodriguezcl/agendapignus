

export function showAgendaValidationModal(missing) {
  document.getElementById('agenda-validation-modal')?.remove()
  const layer = document.createElement('div'); layer.id = 'agenda-validation-modal'; layer.className = 'modal-layer'
  const modal = document.createElement('div'); modal.className = 'modal confirm-modal validation-modal'
  const icon = document.createElement('span'); icon.className = 'confirm-icon danger'; icon.textContent = '!'
  const title = document.createElement('h2'); title.textContent = 'Completá los campos obligatorios'
  const detail = document.createElement('p'); detail.textContent = 'Antes de guardar o copiar la agenda, revisá los siguientes servicios:'
  const list = document.createElement('ul'); list.className = 'validation-list'
  missing.forEach(item => { const entry = document.createElement('li'); entry.textContent = item; list.append(entry) })
  const actions = document.createElement('div'); actions.className = 'confirm-actions'
  const close = document.createElement('button'); close.title = "Cerrá este aviso y volvé a la planificación."; close.className = 'primary modal-dismiss'; close.type = 'button'; close.textContent = 'Entendido'; close.onclick = () => layer.remove()
  actions.append(close); modal.append(icon, title, detail, list, actions); layer.append(modal)
  layer.addEventListener('click', event => { if (event.target === layer) layer.remove() })
  document.body.append(layer)
}

export function showMissingTechniciansModal(teamNumbers, onContinue) {
  document.getElementById('agenda-technicians-modal')?.remove()
  const layer = document.createElement('div'); layer.id = 'agenda-technicians-modal'; layer.className = 'modal-layer'
  const modal = document.createElement('div'); modal.className = 'modal confirm-modal validation-modal'
  const icon = document.createElement('span'); icon.className = 'confirm-icon danger'; icon.textContent = '!'
  const title = document.createElement('h2'); title.textContent = 'Técnicos sin asignar'
  const detail = document.createElement('p'); detail.textContent = `La asignación de al menos un técnico es obligatoria. ${teamNumbers.join(', ')} no tiene técnicos asignados.`
  const note = document.createElement('p'); note.className = 'modal-helper'; note.textContent = 'Podés volver para asignarlos o continuar excepcionalmente bajo tu responsabilidad.'
  const actions = document.createElement('div'); actions.className = 'confirm-actions'
  const cancel = document.createElement('button'); cancel.title = "Volvé a la agenda para asignar los técnicos faltantes."; cancel.className = 'secondary'; cancel.type = 'button'; cancel.textContent = 'Volver y asignar'; cancel.onclick = () => layer.remove()
  actions.append(cancel); modal.append(icon, title, detail, note, actions); layer.append(modal)
  layer.addEventListener('click', event => { if (event.target === layer) layer.remove() })
  document.body.append(layer)
}
