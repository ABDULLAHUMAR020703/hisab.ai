import 'server-only'
import { resolveSequenceRepository } from '@/lib/db/sequence-resolver'

/** Legacy helper — delegates to SequenceRepository. */
export async function getNextSequence(type: string, prefix: string): Promise<string> {
  return resolveSequenceRepository().next(type, prefix)
}
