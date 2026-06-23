import 'server-only'
import { supabaseSequenceRepository } from './repositories/sequence.repository.supabase'
import type { SequenceRepository } from './repositories/sequence.repository.interface'

export function resolveSequenceRepository(): SequenceRepository {
  return supabaseSequenceRepository
}
