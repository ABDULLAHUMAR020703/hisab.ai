import { seedQaData } from '@/lib/qa-seed'

export async function POST() {
  try {
    const qa = await seedQaData()

    return Response.json({
      success: true,
      message: qa.message,
      qa,
    })
  } catch (error) {
    console.error('Seed error:', error)
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
