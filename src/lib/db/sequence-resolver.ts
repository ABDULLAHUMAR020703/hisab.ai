import 'server-only'
import { isSupabaseEnabled } from '@/lib/supabase/env'
import { prismaSequenceRepository } from './repositories/sequence.repository.prisma'
import { supabaseSequenceRepository } from './repositories/sequence.repository.supabase'
import type { SequenceRepository } from './repositories/sequence.repository.interface'

/** Resolves active sequence backend without importing provider (avoids circular deps). */
export function resolveSequenceRepository(): SequenceRepository {
  return isSupabaseEnabled() ? supabaseSequenceRepository : prismaSequenceRepository
}
