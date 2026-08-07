import { createHash } from 'node:crypto'

export type OpeningSubledgerKind='AR'|'AP'
export type OpeningSubledgerDocumentType='INVOICE'|'BILL'|'CUSTOMER_CREDIT'|'VENDOR_CREDIT'

export function openingSubledgerDocumentType(kind:OpeningSubledgerKind,amount:number):OpeningSubledgerDocumentType{
  if(kind==='AR')return amount>=0?'INVOICE':'CUSTOMER_CREDIT'
  return amount>=0?'BILL':'VENDOR_CREDIT'
}

export function openingSubledgerKey(reconciliationId:string,kind:OpeningSubledgerKind,sourceKey:string){
  const digest=createHash('sha256').update(`${kind}:${sourceKey}`).digest('hex').slice(0,24)
  return `quickbooks-cutoff:${reconciliationId}:${kind}:${digest}`
}
