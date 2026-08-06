
import React, { useState } from 'react'

const initialTask = () => ({
  time: '',
  service: '',
  client: '',
  detail: '',
  address: '',
  phone: ''
})

const initialTeam = () => ({
  members: [],
  tasks: [initialTask()]
})

const App = () => {
  const [date, setDate] = useState('')
  const [teams, setTeams] = useState([initialTeam()])
  const technicians = ['Rodrigo', 'Mariano', 'Santos', 'Pascual', 'Leonardo']
  const services = [
    'Instalación de Alarma', 'Instalación de Cámaras', 'Instalación de Cerco Eléctrico', 'Otra Instalación',
    'Service de Alarma', 'Service de Cámara', 'Service de Cerco Eléctrico', 'Otro Service'
  ]

  const handleTeamChange = (index, key, value) => {
    const updatedTeams = [...teams]
    updatedTeams[index][key] = value
    setTeams(updatedTeams)
  }

  const handleTaskChange = (teamIndex, taskIndex, key, value) => {
    const updatedTeams = [...teams]
    updatedTeams[teamIndex].tasks[taskIndex][key] = value
    setTeams(updatedTeams)
  }

  const addTask = (teamIndex) => {
    const updatedTeams = [...teams]
    updatedTeams[teamIndex].tasks.push(initialTask())
    setTeams(updatedTeams)
  }

  const addTeam = () => setTeams([...teams, initialTeam()])

  const generateMessage = () => {
    let msg = `📅 Agenda de trabajo – ${date}\n\n`
    teams.forEach(team => {
      if (team.members.length) {
        msg += `🔧 Equipo: ${team.members.join(' / ')}\n\n`
        team.tasks.forEach(t => {
          msg += `🕘 ${t.time} – ${t.service} – ${t.client}\n`
          msg += `🔸 Detalle: ${t.detail}\n`
          msg += `📍 Dirección: ${t.address}\n`
          msg += `📞 Contacto: ${t.phone}\n\n`
        })
      }
    })
    return msg.trim()
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generateMessage())
    alert('Texto copiado al portapapeles')
  }

  return (
    <div className="container">
      <h2>Agenda Técnica</h2>
      <label>Fecha:</label>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      {teams.map((team, teamIndex) => (
        <fieldset key={teamIndex}>
          <legend>Equipo {teamIndex + 1}</legend>
          <label>Técnicos:</label>
          <select multiple value={team.members} onChange={e => handleTeamChange(teamIndex, 'members', Array.from(e.target.selectedOptions, o => o.value))}>
            {technicians.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {team.tasks.map((task, taskIndex) => (
            <div key={taskIndex}>
              <label>Hora:</label>
              <input type="time" value={task.time} onChange={e => handleTaskChange(teamIndex, taskIndex, 'time', e.target.value)} />
              <label>Tipo de Servicio:</label>
              <select value={task.service} onChange={e => handleTaskChange(teamIndex, taskIndex, 'service', e.target.value)}>
                <option value="">Seleccionar...</option>
                {services.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <label>Nombre del Titular:</label>
              <input type="text" value={task.client} onChange={e => handleTaskChange(teamIndex, taskIndex, 'client', e.target.value)} />
              <label>Observaciones:</label>
              <textarea value={task.detail} onChange={e => handleTaskChange(teamIndex, taskIndex, 'detail', e.target.value)} />
              <label>Dirección:</label>
              <input type="text" value={task.address} onChange={e => handleTaskChange(teamIndex, taskIndex, 'address', e.target.value)} />
              <label>Contacto:</label>
              <input type="text" value={task.phone} onChange={e => handleTaskChange(teamIndex, taskIndex, 'phone', e.target.value)} />
            </div>
          ))}
          <button type="button" onClick={() => addTask(teamIndex)}>Agregar Tarea</button>
        </fieldset>
      ))}
      <button type="button" onClick={addTeam}>Agregar Otro Equipo</button>
      <button type="button" onClick={copyToClipboard}>Copiar Texto</button>
      <pre style={{ whiteSpace: 'pre-wrap', marginTop: '1rem' }}>{generateMessage()}</pre>
    </div>
  )
}

export default App
