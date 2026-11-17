import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const requireBundle=createRequire(pathToFileURL(process.env.VALO_BUNDLED_NODE+'/resolve.cjs'));
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(requireBundle.resolve('@oai/artifact-tool')).href);
const original=await fs.readFile(new URL('./build.mjs',import.meta.url),'utf8');
const {dates,milestones,tasks,issues}=Function(original.slice(original.indexOf('const dates'), original.indexOf('const formatDate'))+'return {dates,milestones,tasks,issues}')();
const offsets={ 'Buổi 8': '09-08', 'Buổi 9':'09-11','Buổi 10':'09-21','Buổi 11':'09-30','Buổi 12':'10-17','Buổi 14':'10-29','Buổi 16':'11-10','Buổi 17':'11-16' };
const date=(suffix)=>new Date('2026-'+suffix+'T00:00:00Z');
const scanDate=(label)=>date(label.slice(3)+'-'+label.slice(0,2));
const format=(d)=>[d.getUTCDate(),d.getUTCMonth()+1,d.getUTCFullYear()].map(x=>String(x).padStart(2,'0')).join('/');
const add=(d,n)=>new Date(+d+n*86400000);
const week1=date('09-01');
const findDate=(note)=>date(offsets[note.split(',')[0].split('.')[0]]);
const range=(i)=>[add(week1,7*i),add(week1,7*i+6)];
const inWeek=(note,start,end)=>findDate(note)>=start&&findDate(note)<=end;
const references={
  1:[['Mentor feedback on AI booking and IoT','Mentor','10/09/2026','Voice booking, IoT demo and Reports 4–5.']],
  10:[['Mentor meeting','Mentor','13/11/2026','Meeting date from the minutes tab.']],
  13:[['Final Release','','10/12/2026 – 15/12/2026','Final defense and release milestone.']],
};
const workbook=Workbook.create();
const allTasks=tasks.flat();
const allIssues=Object.values(issues).flat();
const result=[];
for(let i=0;i<14;i++){
  const [start,end]=range(i);
  const records=allTasks.filter(t=>inWeek(t[2],start,end));
  const current=dates.map(([a,b],j)=>({label:j<8?'Sprint '+(j+1):'Final Release',from:scanDate(a),to:scanDate(b),milestone:milestones[j]})).filter(d=>d.from<=end&&d.to>=start);
  const nextStart=add(end,1),nextEnd=add(end,7);
  const upcoming=dates.map(([a,b],j)=>({label:j<8?'Sprint '+(j+1):'Final Release',from:scanDate(a),to:scanDate(b),milestone:milestones[j]})).filter(d=>d.from<=nextEnd&&d.to>=nextStart);
  const status=records.map(([task,owner,note])=>[task,owner,'Assigned',note]);
  if(!status.length)status.push([current.map(c=>c.milestone).join(' / '),'','Planned','Theo milestone. Chưa có phân công xác nhận trong biên bản đối chiếu.']);
  const problem=allIssues.filter(t=>inWeek(t[2],start,end)).map(([task,owner,note])=>[task,owner,'To review',note]);
  const plan=upcoming.map(c=>[c.milestone,'',format(c.to),c.label+' milestone']);
  for(const [task,owner,note] of allTasks.filter(t=>findDate(t[2]).getTime()===+end||(+findDate(t[2])>=+add(end,-1)&&+findDate(t[2])<=+end)).slice(0,2)){
    if(plan.length<4)plan.push([task,owner,'',note]);
  }
  const matters=[...current.map(c=>[c.label,'',format(c.from)+' – '+format(c.to),c.milestone]),...(references[i]??[])];
  result.push({title:'Week '+(i+1),date:format(start)+' - '+format(end),sections:[status,problem,plan,matters]});
  const sheet=workbook.worksheets.add('Week '+(i+1));
  const rows=[['Week',format(start)+' - '+format(end),'','',''],...result[i].sections.flatMap(section=>section.map((r,k)=>[k+1,...r]))];
  sheet.getRangeByIndexes(0,0,rows.length,5).values=rows;
}
await fs.writeFile(new URL('./weekly-values.json',import.meta.url),JSON.stringify(result));
const out=await SpreadsheetFile.exportXlsx(workbook);
await out.save(fileURLToPath(new URL('./weekly-values.xlsx',import.meta.url)));
