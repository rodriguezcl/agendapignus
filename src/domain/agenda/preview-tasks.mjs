// Build a presentation copy: never reorder the editable planning state.
export function agendaPreviewTasks(tasks = []) {
  const minutes = task => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(task.time || task.scheduledTime || '')
    return match && Number(match[1]) < 24 && Number(match[2]) < 60
      ? Number(match[1]) * 60 + Number(match[2]) : Infinity
  }
  return tasks.filter(task => task.awaitingConfirmation !== true)
    .sort((left, right) => minutes(left) - minutes(right))
}
