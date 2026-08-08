import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const input = await FileBlob.load('C:/Users/rodri/Downloads/Informe_2026.xlsx')
const workbook = await SpreadsheetFile.importXlsx(input)
const summary = await workbook.inspect({ kind: 'workbook,sheet,table', maxChars: 8000, tableMaxRows: 12, tableMaxCols: 12, tableMaxCellChars: 80 })
console.log(summary.ndjson)
