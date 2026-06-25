import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSupabaseUrl } from '@/lib/supabase/env'
import { COMPANY_BRANDING_BUCKET } from './constants'

export function companyLogoStoragePath(companyId: string): string {
  return `${companyId}/branding/logo.png`
}

export function getCompanyLogoPublicUrl(storagePath: string): string {
  const base = getSupabaseUrl().replace(/\/$/, '')
  return `${base}/storage/v1/object/public/${COMPANY_BRANDING_BUCKET}/${storagePath}`
}

export async function uploadCompanyLogoPng(
  companyId: string,
  pngBuffer: Buffer,
): Promise<{ storagePath: string; publicUrl: string }> {
  const storagePath = companyLogoStoragePath(companyId)
  const supabase = createAdminClient()

  const { error } = await supabase.storage
    .from(COMPANY_BRANDING_BUCKET)
    .upload(storagePath, pngBuffer, {
      contentType: 'image/png',
      upsert: true,
      cacheControl: '60',
    })

  if (error) throw error

  return {
    storagePath,
    publicUrl: getCompanyLogoPublicUrl(storagePath),
  }
}

export async function deleteCompanyLogoFile(storagePath: string | null | undefined): Promise<void> {
  if (!storagePath?.trim()) return
  const supabase = createAdminClient()
  const { error } = await supabase.storage.from(COMPANY_BRANDING_BUCKET).remove([storagePath])
  if (error) {
    console.error('[branding] failed to delete logo from storage:', error.message)
  }
}

export async function downloadCompanyLogoBuffer(
  storagePath: string | null | undefined,
): Promise<Buffer | null> {
  if (!storagePath?.trim()) return null

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.storage
      .from(COMPANY_BRANDING_BUCKET)
      .download(storagePath)

    if (error || !data) {
      console.error('[branding] logo download failed:', error?.message ?? 'empty response')
      return null
    }

    const buffer = Buffer.from(await data.arrayBuffer())
    return buffer.length > 0 ? buffer : null
  } catch (error) {
    console.error('[branding] logo download error:', error)
    return null
  }
}
