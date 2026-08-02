import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

async function main(){
  const runId=process.argv.find(value=>value.startsWith('--run='))?.slice(6)
  const {createAdminClient}=await import('../../src/lib/supabase/admin'),db=createAdminClient()
  let query=db.from('quickbooks_certification_runs').select('id,status,report,started_at,completed_at').order('created_at',{ascending:false}).limit(1)
  if(runId)query=db.from('quickbooks_certification_runs').select('id,status,report,started_at,completed_at').eq('id',runId).limit(1)
  const result=await query.single();if(result.error)throw result.error
  const report=result.data.report as {summary?:unknown;sections?:Array<Record<string,unknown>>}
  const sections=(report.sections??[]).map(section=>({reportKey:section.reportKey,status:section.status,comparedRows:section.comparedRows,matchedRows:section.matchedRows,maximumDifference:section.maximumDifference,error:section.error,differenceCount:Array.isArray(section.differences)?section.differences.length:0,differences:(Array.isArray(section.differences)?section.differences:[]).slice(0,20)}))
  if(process.argv.includes('--summary')){console.log(JSON.stringify({id:result.data.id,status:result.data.status,summary:report.summary,sections:sections.map(section=>({reportKey:section.reportKey,status:section.status,comparedRows:section.comparedRows,matchedRows:section.matchedRows,maximumDifference:section.maximumDifference,error:section.error,differenceCount:section.differenceCount,firstDifference:section.differences[0]??null}))},null,2));return}
  console.log(JSON.stringify({id:result.data.id,status:result.data.status,startedAt:result.data.started_at,completedAt:result.data.completed_at,summary:report.summary,sections},null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
