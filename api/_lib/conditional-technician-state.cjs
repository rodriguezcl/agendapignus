function technicianStateUnchanged(query, revision, today) {
  return query?.revision != null && /^\d+$/.test(String(query.revision)) &&
    Number(query.revision) === Number(revision) && query.day === today
}
module.exports = { technicianStateUnchanged }
