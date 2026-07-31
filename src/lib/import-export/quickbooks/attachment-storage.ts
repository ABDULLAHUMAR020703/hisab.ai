import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export async function storeQuickBooksAttachment(input:{ companyId:string; realmId:string; id:string; fileName:string; mimeType:string; content:Uint8Array }) {
  const safeName = input.fileName.replace(/[^A-Za-z0-9._-]/g, '_')
  const storagePath = `${input.companyId}/quickbooks/${input.realmId}/${input.id}/${safeName}`
  const upload = await createAdminClient().storage.from('quickbooks-migration').upload(storagePath,input.content,{ contentType:input.mimeType, upsert:true })
  if (upload.error) throw upload.error
  return storagePath
}
