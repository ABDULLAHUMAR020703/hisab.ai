import { requireAuth } from '@/lib/auth'
import { getAccountRepository } from '@/lib/db/provider'
import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const account = await getAccountRepository().findById(id)
    if (!account) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json(account)
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const body = await request.json()
    const account = await prisma.chartOfAccount.update({
      where: { id },
      data: {
        name: body.name,
        fullName: body.fullName,
        parentNo: body.parentNo,
        accountType: body.accountType,
        subType: body.subType,
        description: body.description,
        isActive: body.isActive,
      },
    })
    return Response.json(account)
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    await prisma.chartOfAccount.delete({ where: { id } })
    return Response.json({ success: true })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
