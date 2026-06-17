import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/zatca/invoices/:id/signed-xml
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth()
    const { id } = await params

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { signedXml: true, invoiceNo: true },
    })

    if (!invoice) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (!invoice.signedXml) {
      return Response.json({ error: 'Signed XML not available. Submit invoice to ZATCA first.' }, { status: 404 })
    }

    return new Response(invoice.signedXml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `inline; filename="${invoice.invoiceNo}-signed.xml"`,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
