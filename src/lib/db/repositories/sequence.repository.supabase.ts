import 'server-only'
import { resolveCompanyId, supabaseDb } from '../repository-utils'
import type { SequenceRepository } from './sequence.repository.interface'

export const supabaseSequenceRepository: SequenceRepository = {
  async next(type: string, prefix: string) {
    const db = supabaseDb()
    const companyId = await resolveCompanyId()

    const { data: existing, error: fetchError } = await db
      .from('sequences')
      .select('*')
      .eq('company_id', companyId)
      .eq('type', type)
      .maybeSingle()

    if (fetchError) throw fetchError

    let nextNo: number
    if (!existing) {
      nextNo = 1
      const { error: insertError } = await db.from('sequences').insert({
        company_id: companyId,
        type,
        prefix,
        next_no: 2,
      })
      if (insertError) throw insertError
    } else {
      nextNo = Number(existing.next_no)
      const { error: updateError } = await db
        .from('sequences')
        .update({ next_no: nextNo + 1 })
        .eq('id', existing.id)
      if (updateError) throw updateError
    }

    return `${prefix}${String(nextNo).padStart(5, '0')}`
  },
}
