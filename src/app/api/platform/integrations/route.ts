import { requireAuth } from '@/lib/auth'
import { authzErrorResponse } from '@/lib/authz'
import { listConnectors, listConnections, createConnection } from '@/lib/platform/integrations/registry'
import { requirePlatformAdmin } from '@/lib/platform/require-admin'

export async function GET() {
  try {
    await requireAuth()
    const [connectors, connections] = await Promise.all([listConnectors(), listConnections()])
    return Response.json({ connectors, connections })
  } catch (error) {
    return authzErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    await requirePlatformAdmin()
    const body = await request.json()
    const connection = await createConnection({
      connectorKey: body.connectorKey,
      name: body.name,
      credentials: body.credentials,
      settings: body.settings,
    })
    return Response.json(connection, { status: 201 })
  } catch (error) {
    return authzErrorResponse(error)
  }
}
