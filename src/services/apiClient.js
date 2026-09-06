// Compatibility adapter for older imports. New code should depend on the
// repository in infrastructure/repositories instead of a generic API object.
import { stateRepository } from '../infrastructure/repositories/state-repository.mjs'

export const apiClient = {
  getState: stateRepository.load,
  saveState: stateRepository.save
}
