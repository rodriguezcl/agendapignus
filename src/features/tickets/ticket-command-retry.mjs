// A retry must keep the original version and command identifier: the server
// may have saved the first attempt even when its response did not arrive.
export async function prepareTicketCommand(previous, intent, preparePayload, createId) {
  const fingerprint = JSON.stringify(intent)
  if (previous?.fingerprint === fingerprint) return previous
  const payload = await preparePayload()
  return { fingerprint, payload, id: createId() }
}
