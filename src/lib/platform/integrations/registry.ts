import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCompanyId } from '@/lib/tenant'

export async function listConnectors() {
  const client = createAdminClient()
  const { data, error } = await client
    .from('integration_connectors')
    .select('*')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function listConnections(companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from('integration_connections')
    .select('id, company_id, connector_id, name, status, settings, created_at, updated_at, connector:integration_connectors(provider_key, name, connector_type)')
    .eq('company_id', cid)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function createConnection(input: {
  connectorKey: string
  name: string
  credentials?: Record<string, unknown>
  settings?: Record<string, unknown>
  companyId?: string
}) {
  const cid = input.companyId ?? await resolveCompanyId()
  const client = createAdminClient()

  const { data: connector } = await client
    .from('integration_connectors')
    .select('id')
    .eq('provider_key', input.connectorKey)
    .single()

  if (!connector) throw new Error(`Unknown connector: ${input.connectorKey}`)

  const { data, error } = await client
    .from('integration_connections')
    .insert({
      company_id: cid,
      connector_id: connector.id,
      name: input.name,
      credentials: input.credentials ?? {},
      settings: input.settings ?? {},
      status: 'CONNECTED',
    })
    .select('id, company_id, connector_id, name, status, settings, created_at, connector:integration_connectors(provider_key, name)')
    .single()

  if (error) throw error
  return data
}

export async function getConnectionCredentials(connectionId: string, companyId?: string) {
  const cid = companyId ?? await resolveCompanyId()
  const client = createAdminClient()
  const { data, error } = await client
    .from('integration_connections')
    .select('credentials, connector:integration_connectors(provider_key)')
    .eq('id', connectionId)
    .eq('company_id', cid)
    .single()
  if (error) throw error
  return data
}
