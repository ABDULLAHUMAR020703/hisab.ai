export type QuickBooksPaymentKind = 'CUSTOMER'|'VENDOR'

export interface QuickBooksPaymentAllocation {
  sourceLineKey:string
  targetType:'Invoice'|'Bill'
  targetSourceId:string
  amount:number
  cashAmount:number
  creditAmount:number
  creditSourceIds:string[]
  linkedTransactions:Array<{type:string;id:string}>
}

export interface QuickBooksPaymentRelationships {
  paymentAmount:number
  appliedAmount:number
  creditAppliedAmount:number
  unappliedAmount:number
  allocations:QuickBooksPaymentAllocation[]
  issues:string[]
}

type Row=Record<string,unknown>
const object=(value:unknown):Row=>value&&typeof value==='object'?value as Row:{}
const number=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0
const round=(value:number)=>Math.round(value*10_000)/10_000

export function extractQuickBooksPaymentRelationships(raw:Row,kind:QuickBooksPaymentKind):QuickBooksPaymentRelationships {
  const targetType=kind==='CUSTOMER'?'Invoice':'Bill',creditType=kind==='CUSTOMER'?'CreditMemo':'VendorCredit'
  const paymentAmount=round(number(raw.TotalAmt??raw.Amount)),reportedUnapplied=Math.max(0,round(number(raw.UnappliedAmt)))
  const allocations:QuickBooksPaymentAllocation[]=[],issues:string[]=[],standaloneCredits:Array<{sourceId:string;remaining:number}>=[]
  for(const [index,lineValue] of (Array.isArray(raw.Line)?raw.Line:[]).entries()){
    const line=object(lineValue),linked=(Array.isArray(line.LinkedTxn)?line.LinkedTxn:[]).map(item=>object(item))
    const targets=linked.filter(item=>String(item.TxnType??'').toLowerCase()===targetType.toLowerCase())
    const credits=linked.filter(item=>String(item.TxnType??'').toLowerCase()===creditType.toLowerCase())
    if(targets.length===0){for(const credit of credits){const id=String(credit.TxnId??'');if(id)standaloneCredits.push({sourceId:id,remaining:round(number(line.Amount))})}continue}
    if(targets.length!==1){issues.push(`Payment line ${index+1} links ${targets.length} ${targetType} records; the allocation amount is ambiguous.`);continue}
    const targetSourceId=String(targets[0].TxnId??'')
    const amount=round(number(line.Amount))
    if(!targetSourceId||amount<=0){issues.push(`Payment line ${index+1} has no target ID or positive allocation amount.`);continue}
    allocations.push({sourceLineKey:`line:${index}:${targetType}:${targetSourceId}`,targetType,targetSourceId,amount,cashAmount:amount,creditAmount:0,creditSourceIds:credits.map(item=>String(item.TxnId??'')).filter(Boolean),linkedTransactions:linked.map(item=>({type:String(item.TxnType??''),id:String(item.TxnId??'')})).filter(item=>item.id)})
  }
  const totalApplied=round(allocations.reduce((sum,item)=>sum+item.amount,0)),cashApplied=Math.max(0,round(paymentAmount-reportedUnapplied))
  let creditRemaining=Math.max(0,round(totalApplied-cashApplied))
  for(const allocation of allocations){
    if(!allocation.creditSourceIds.length&&creditRemaining>0){let needed=Math.min(allocation.amount,creditRemaining);for(const credit of standaloneCredits){if(needed<=0)break;const used=Math.min(needed,credit.remaining);if(used<=0)continue;allocation.creditSourceIds.push(credit.sourceId);credit.remaining=round(credit.remaining-used);needed=round(needed-used)}}
    if(!allocation.creditSourceIds.length)continue
    allocation.creditAmount=Math.min(allocation.amount,creditRemaining);allocation.cashAmount=round(allocation.amount-allocation.creditAmount);creditRemaining=round(creditRemaining-allocation.creditAmount)
  }
  for(const allocation of allocations)if(allocation.creditAmount>0&&allocation.creditSourceIds.length!==1)issues.push(`${allocation.sourceLineKey} must identify exactly one credit for ${allocation.creditAmount.toFixed(4)} of applied credit.`)
  if(creditRemaining>0)issues.push(`${creditRemaining.toFixed(4)} of applied credits cannot be tied to an explicit QuickBooks credit relationship.`)
  const allocatedCash=round(allocations.reduce((sum,item)=>sum+item.cashAmount,0))
  if(Math.abs(allocatedCash-cashApplied)>0.0001)issues.push(`QuickBooks cash application total ${cashApplied.toFixed(4)} does not equal linked-line cash ${allocatedCash.toFixed(4)}.`)
  return {paymentAmount,appliedAmount:allocatedCash,creditAppliedAmount:round(allocations.reduce((sum,item)=>sum+item.creditAmount,0)),unappliedAmount:reportedUnapplied,allocations,issues}
}
