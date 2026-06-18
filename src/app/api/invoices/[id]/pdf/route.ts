import { requireAuth } from '@/lib/auth'
import { generateInvoicePdf } from '@/lib/invoices/pdf'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/invoices/:id/pdf
 * Downloads a printable PDF tax invoice with ZATCA QR when available.
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
      include: {
        customer: true,
        lines: { orderBy: { id: 'asc' } },
      },
    })

    if (!invoice) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const settings = await prisma.companySettings.findFirst()
    if (!settings) {
      return Response.json({ error: 'Company settings not found' }, { status: 404 })
    }

    const pdf = await generateInvoicePdf(invoice, settings)
    const filename = `${invoice.invoiceNo.replace(/[^\w.-]+/g, '_')}.pdf`

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
