const { jsPDF } = require('jspdf')

const COLORS = {
  green: '#123122', greenText: '#173626', gold: '#C99311', paleGold: '#F4ECD3',
  paleGreen: '#F5F8F5', border: '#D9E4DA', muted: '#617468', white: '#FFFFFF'
}

const text = value => String(value ?? '').trim() || '-'

function writeProfessionalPdf(stream, { title, description, monthLabel, generatedAt, headers, rows, widths, fileName }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true })
  doc.setProperties({ title, subject: description, author: 'PIGNUS', creator: 'Agenda técnica PIGNUS' })

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const left = 36
  const contentWidth = pageWidth - 72
  const tableStartY = 178
  const tableEndY = pageHeight - 70
  const setText = (color, style = 'normal', size = 8) => {
    doc.setTextColor(color)
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
  }

  const drawReportHeader = () => {
    doc.setFillColor(COLORS.green)
    doc.rect(0, 0, pageWidth, 110, 'F')
    setText(COLORS.gold, 'bold', 8.5)
    doc.setCharSpace(1.1)
    doc.text('PIGNUS  ·  GESTIÓN OPERATIVA', left, 25)
    doc.setCharSpace(0)
    setText(COLORS.white, 'bold', 21)
    doc.text(title, left, 56)
    setText('#D5E2D9', 'normal', 8.5)
    doc.text(description, left, 78, { maxWidth: contentWidth })
    doc.setFillColor(COLORS.paleGold)
    doc.rect(left, 110, contentWidth, 31, 'F')
    setText(COLORS.greenText, 'bold', 8.5)
    doc.text(`PERÍODO  ${monthLabel.toUpperCase()}`, left + 10, 129)
    setText(COLORS.muted, 'normal', 8.5)
    doc.text(`TOTAL  ${rows.length}    ·    GENERADO  ${generatedAt}`, left + 250, 129)
  }

  const drawTableHeader = () => {
    doc.setFillColor(COLORS.gold)
    doc.rect(left, 153, contentWidth, 25, 'F')
    setText(COLORS.white, 'bold', 7.5)
    let x = left
    headers.forEach((header, index) => {
      doc.text(header.toUpperCase(), x + 5, 169, { maxWidth: widths[index] - 10 })
      x += widths[index]
    })
  }

  const drawFooter = pageNumber => {
    doc.setDrawColor(COLORS.gold)
    doc.setLineWidth(0.6)
    doc.line(left, pageHeight - 55, left + contentWidth, pageHeight - 55)
    setText(COLORS.muted, 'normal', 7)
    doc.text('Agenda técnica PIGNUS · Documento de uso interno', left, pageHeight - 42)
    doc.text(`Página ${pageNumber}`, left + contentWidth, pageHeight - 42, { align: 'right' })
  }

  setText(COLORS.greenText, 'normal', 7.5)
  const measuredRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, index) => doc.splitTextToSize(text(value), widths[index] - 10))
    const rowHeight = Math.max(26, Math.max(...cells.map(lines => lines.length * 9 + 10)))
    return { cells, rowIndex, rowHeight }
  })
  const pages = []
  let currentPage = []
  let measuredY = tableStartY
  measuredRows.forEach(measuredRow => {
    if (currentPage.length && measuredY + measuredRow.rowHeight > tableEndY) {
      pages.push(currentPage)
      currentPage = []
      measuredY = tableStartY
    }
    currentPage.push(measuredRow)
    measuredY += measuredRow.rowHeight
  })
  if (currentPage.length || !pages.length) pages.push(currentPage)

  pages.forEach((pageRows, pageIndex) => {
    if (pageIndex) doc.addPage('a4', 'landscape')
    drawReportHeader()
    drawTableHeader()
    let y = tableStartY
    pageRows.forEach(({ cells, rowIndex, rowHeight }) => {
      if (rowIndex % 2) {
        doc.setFillColor(COLORS.paleGreen)
        doc.rect(left, y, contentWidth, rowHeight, 'F')
      }
      doc.setDrawColor(COLORS.border)
      doc.setLineWidth(0.5)
      doc.line(left, y + rowHeight, left + contentWidth, y + rowHeight)
      setText(COLORS.greenText, 'normal', 7.5)
      let x = left
      cells.forEach((lines, index) => {
        doc.text(lines, x + 5, y + 11, { lineHeightFactor: 1.15, maxWidth: widths[index] - 10 })
        x += widths[index]
      })
      y += rowHeight
    })
    if (!pageRows.length) {
      setText(COLORS.muted, 'italic', 10)
      doc.text('No existen registros para el período seleccionado.', left + 10, y + 22)
    }
    drawFooter(pageIndex + 1)
  })

  stream.end(Buffer.from(doc.output('arraybuffer')))
  return fileName
}

module.exports = { writeProfessionalPdf }
