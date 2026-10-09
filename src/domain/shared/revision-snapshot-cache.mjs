// Keep just one pending remote snapshot while a local draft prevents applying it.
// Rejections aren't cached, so the next poll can retry a transient failure.
export function createRevisionSnapshotCache() {
  let cached
  return async (revision, load) => {
    if (cached && Number(cached.revision) === Number(revision)) return cached
    cached = await load()
    return cached
  }
}
