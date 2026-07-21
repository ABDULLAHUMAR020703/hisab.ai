import { requireAuth } from '@/lib/auth'
import {
  buildClassTemplateSheet,
  buildLocationTemplateSheet,
  buildProjectTemplateSheet,
} from '@/lib/cost-centers/import/parsers'
import type { CostCenterImportKind } from '@/lib/cost-centers/import/parsers'

function templateForKind(kind: CostCenterImportKind): { buffer: ArrayBuffer; filename: string } {
  if (kind === 'location') {
    return {
      buffer: buildLocationTemplateSheet(),
      filename: 'Location-List-template.xlsx',
    }
  }
  if (kind === 'class') {
    return {
      buffer: buildClassTemplateSheet(),
      filename: 'Class-List-template.xlsx',
    }
  }
  return {
    buffer: buildProjectTemplateSheet(),
    filename: 'Product-Service-List-template.xlsx',
  }
}

export async function handleCostCenterTemplateDownload(kind: CostCenterImportKind) {
  try {
    await requireAuth()
    const { buffer, filename } = templateForKind(kind)
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
