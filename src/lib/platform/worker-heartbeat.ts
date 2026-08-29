import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export async function touchWorkerHeartbeat(workerName: string, pid?: number) {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const upsert = await admin
    .from('worker_heartbeats')
    .upsert({ worker_name: workerName, pid: pid ?? null, last_heartbeat_at: now, updated_at: now }, { onConflict: 'worker_name' })
  return upsert
}

export async function getWorkerHeartbeats() {
  const admin = createAdminClient()
  const { data, error } = await admin.from('worker_heartbeats').select('*')
  if (error) throw error
  return data
}
