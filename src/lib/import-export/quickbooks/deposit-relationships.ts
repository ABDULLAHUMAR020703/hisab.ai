export interface QuickBooksDepositAllocation {
  sourceLineKey:string
  amount:number
  sourceTransactionType:string
  sourceTransactionId:string|null
  sourceAccountId:string|null
  sourceEntityId:string|null
  description:string
  metadata:Record<string,unknown>
}
export interface QuickBooksDepositRelationships {total:number;allocations:QuickBooksDepositAllocation[];issues:string[]}
type Row=Record<string,unknown>
const object=(value:unknown):Row=>value&&typeof value==='object'?value as Row:{}
const number=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0
const round=(value:number)=>Math.round(value*10_000)/10_000

export function extractQuickBooksDepositRelationships(raw:Row):QuickBooksDepositRelationships{
  const allocations:QuickBooksDepositAllocation[]=[],issues:string[]=[]
  for(const [index,value] of (Array.isArray(raw.Line)?raw.Line:[]).entries()){
    const line=object(value),detail=object(line.DepositLineDetail),account=object(detail.AccountRef),entity=object(detail.EntityRef),linked=(Array.isArray(line.LinkedTxn)?line.LinkedTxn:[]).map(object).filter(item=>item.TxnId)
    if(linked.length>1){issues.push(`Deposit line ${index+1} contains ${linked.length} linked transactions and cannot be assigned an exact line amount.`);continue}
    const relationship=linked[0],transactionType=String(relationship?.TxnType??'Account'),transactionId=relationship?.TxnId?String(relationship.TxnId):null,accountId=account.value?String(account.value):null,amount=round(number(line.Amount))
    if(amount===0){issues.push(`Deposit line ${index+1} has a zero amount.`);continue}
    if(!transactionId&&!accountId){issues.push(`Deposit line ${index+1} has neither a linked transaction nor an account.`);continue}
    allocations.push({sourceLineKey:`line:${index}:${transactionType}:${transactionId??accountId}`,amount,sourceTransactionType:transactionType,sourceTransactionId:transactionId,sourceAccountId:accountId,sourceEntityId:entity.value?String(entity.value):null,description:String(line.Description??''),metadata:{linkedTransactions:linked,paymentMethodRef:detail.PaymentMethodRef??null,checkNum:detail.CheckNum??null}})
  }
  const total=round(number(raw.TotalAmt)),lineTotal=round(allocations.reduce((sum,item)=>sum+item.amount,0))
  if(Math.abs(total-lineTotal)>0.0001)issues.push(`QuickBooks deposit total ${total.toFixed(4)} does not equal line allocations ${lineTotal.toFixed(4)}.`)
  return {total,allocations,issues}
}
