const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('customer confirmation has a shared blue palette across modules and a dark variant', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/constitution-ui.css'), 'utf8')
  const weekly = fs.readFileSync(path.join(__dirname, '../src/weekly-enhancements.css'), 'utf8')
  for (const selector of ['.app-shell .pending-reminder-confirmation', '.app-shell .service-confirmation-button.awaiting', '.modal.history-detail > .history-actions > .service-confirmation-button.awaiting:hover', '.app-shell .service-confirmation-label', '.week-task-summary > .service-confirmation-label']) assert.ok(css.includes(selector), selector)
  assert.match(css, /--confirmation-text: #1d4e89;/)
  assert.match(css, /\.app-shell\[data-theme="dark"\], body.dark \{\s*--confirmation-text: #c8e0ff;/)
  assert.match(css, /color: var\(--confirmation-text\);\s*background: var\(--confirmation-background\);\s*border-color: var\(--confirmation-border\);/)
  assert.match(weekly, /color: var\(--confirmation-text, #1d4e89\);/)
  assert.doesNotMatch(weekly, /#936000|#fff5d9|#f2cb69/)
  assert.match(css, /\.pending-reminder-confirmation > svg,[\s\S]*?color: inherit;/)
})

test('daily confirmation uses the same responsive size rules as other daily actions', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/ui-polish.css'), 'utf8')
  const selector = '.content > .team-card .daily-task-actions :is(.icon-btn, .daily-save-button, .service-confirmation-button)'
  assert.ok(css.split(selector).length - 1 >= 4, 'shared base, label, tablet and mobile rules')
  const rule = css.split(selector).map(part => part.slice(0, part.indexOf('}'))).find(part => part.includes('box-sizing: border-box'))
  assert.ok(rule, 'constrained action sizing rule exists')
  for (const declaration of ['box-sizing: border-box', 'max-width: 100%', 'min-width: 0', 'white-space: normal', 'font-size: 11px', 'justify-content: center', 'text-align: center']) assert.ok(rule.includes(declaration), declaration)
})

test('history confirmation belongs to the bottom action group, not the heading notice', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')
  const modal = source.slice(source.indexOf('function HistoryManagementDetail('), source.indexOf('function HistoryDetail('))
  const notice = modal.slice(modal.indexOf('className="history-confirmation-actions"'), modal.indexOf('{record.subscriberReservation &&'))
  assert.match(notice, /\(A CONFIRMAR\)/)
  assert.doesNotMatch(notice, /ServiceConfirmationButton/)
  assert.match(modal, /<div className="history-actions">\{record.awaitingConfirmation === true && <ServiceConfirmationButton/)
})

test('history actions have equal widths and stretch to a shared height with mobile wrapping', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/ui-polish.css'), 'utf8')
  assert.match(css, /grid-template-columns: repeat\(auto-fit, minmax\(120px, 1fr\)\);\s*align-items: stretch;/)
  assert.match(css, /\.modal.history-detail > \.history-actions > button \{[^}]*align-self: stretch;[^}]*height: 100% !important;[^}]*min-height: 56px !important;[^}]*width: 100%;/)
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.modal.history-detail > \.history-actions \{ grid-template-columns: 1fr 1fr;/)
})
