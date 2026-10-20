import { taskHasContent, traceLines } from "../features/agenda/application/agenda-model.mjs";

export const appendTraceElement = (container, record) => {
  if (!container || !taskHasContent(record)) return
  container.querySelector(':scope > .service-trace')?.remove()
  const trace = document.createElement('div')
  trace.className = 'service-trace compact'
  traceLines(record).forEach(line => { const span = document.createElement('span'); span.textContent = line; trace.append(span) })
  container.append(trace)
}
