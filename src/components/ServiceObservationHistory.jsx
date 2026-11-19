import React from 'react'
import observations from '../../api/_lib/service-observation-history.cjs'
import { prettyReportDateTime } from '../features/agenda/application/agenda-model.mjs'
export default function ServiceObservationHistory({ record }) {
  return observations.serviceObservations(record).map(report => <div key={report.id} className="detail-notes technician-report-detail agenda-technical-note">
    <b>{report.label} · {report.byName}{report.status ? ' · ' + report.status : ''}</b>
    <p style={{ whiteSpace: 'pre-wrap' }}>{report.body}</p>
    {report.at && <small>{prettyReportDateTime(report.at)}</small>}
  </div>)
}
