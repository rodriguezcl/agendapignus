// Called inside the existing state transaction: a failed save never queues mail.
async function syncServiceEffects(ticketStore, previous, next, options, kind) {
  await ticketStore.syncServices(previous,next,options)
  await require('./installation-experience-store.cjs').createExperienceStore({[kind]:options.connection}).enqueue(previous,next,options.now)
  await require('./native-registration.cjs').autoCreate(previous,next,options.connection,kind)
}
module.exports={syncServiceEffects}
