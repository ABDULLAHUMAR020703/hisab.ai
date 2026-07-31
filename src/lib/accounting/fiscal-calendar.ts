export function fiscalPeriodForDate(date:Date,fiscalYearStart:string){
  const match=/^(\d{2})-(\d{2})$/.exec(fiscalYearStart),month=match?Number(match[1])-1:0,day=match?Number(match[2]):1
  const boundary=Date.UTC(date.getUTCFullYear(),month,day),startYear=date.getTime()>=boundary?date.getUTCFullYear():date.getUTCFullYear()-1
  const start=new Date(Date.UTC(startYear,month,day)),end=new Date(Date.UTC(startYear+1,month,day)-1)
  return {start,end,fiscalYear:end.getUTCFullYear()}
}

export function nextFiscalPeriod(periodEnd:Date){
  const start=new Date(periodEnd.getTime()+1),end=new Date(Date.UTC(start.getUTCFullYear()+1,start.getUTCMonth(),start.getUTCDate())-1)
  return {start,end,fiscalYear:end.getUTCFullYear()}
}
