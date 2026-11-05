import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createServer } from 'vite';
let server, hooks, panels;
before(async()=>{
 server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{
  name:'calendar-workspace-fixture',enforce:'pre',
  resolveId(id){if(id==='virtual:calendar-hooks')return '\0'+id;},
  load(id){if(id==='\0virtual:calendar-hooks')return `let state=[],cursor=0; export const seed=()=>{state=[];cursor=0;}; export const rewind=()=>{cursor=0;}; export const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];}; export const useId=()=>'calendar-fixture'; export const useLayoutEffect=()=>{}; export const useRef=value=>({current:value});`;},
  transform(source,id){if(id.replaceAll('\\','/').endsWith('/PricingPanels.jsx'))return source.replace("from 'react'","from 'virtual:calendar-hooks'");},
 }]});
 hooks=await server.ssrLoadModule('virtual:calendar-hooks'); panels=await server.ssrLoadModule('/src/pages/Admin/PricingPanels.jsx');
});
after(async()=>{await server?.close();});
const nodes=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(nodes)];
const policy=(name)=>({name,scope:'weekday',daysOfWeek:[1,5],months:[],startDate:'',endDate:'',adjustmentPercent:-10,priority:2,isActive:true});
let policies;
const props=()=>({policies,onAdd(){policies=[...policies,policy('')];},onChange(index,key,value){policies=policies.map((p,i)=>i===index?{...p,[key]:value}:p);},onRemove(index){policies=policies.filter((_,i)=>i!==index);}});
const render=()=>{hooks.rewind();return panels.PricePolicyEditor(props());};
const rows=t=>nodes(t).filter(n=>n.type==='button'&&n.props.className?.includes('calendar-policy-row'));
const editors=t=>nodes(t).filter(n=>n.props.className==='pricing-policy-editor');
const control=(t,label)=>nodes(t).find(n=>n.props['aria-label']===label);
function setup(){policies=[policy('Weekday'),policy('Weekend')];hooks.seed();return render();}

test('workspace starts empty and selecting a row loads one editor with linked controls',()=>{
 let tree=setup();assert.equal(rows(tree).length,2);assert.equal(editors(tree).length,0);
 rows(tree)[0].props.onClick();tree=render();assert.equal(editors(tree).length,1);
 assert.equal(control(tree,'Toggle policy Weekday').props['aria-pressed'],true);
 rows(tree)[1].props.onClick();tree=render();assert.equal(editors(tree).length,1);assert.ok(control(tree,'Toggle policy Weekend'));
 assert.equal(rows(tree)[1].props['aria-pressed'],true);
 assert.equal(rows(tree)[1].props['aria-controls'],nodes(tree).find(n=>n.props.className==='calendar-detail').props.id);
});

test('switching preserves edits; adding opens shared editor; deletion returns to empty state',()=>{
 let tree=setup();rows(tree)[0].props.onClick();tree=render();
 nodes(editors(tree)[0]).find(n=>n.type==='input'&&n.props.placeholder==='e.g. Holiday pricing').props.onChange({target:{value:'Unsaved name'}});
 tree=render();rows(tree)[1].props.onClick();tree=render();rows(tree)[0].props.onClick();tree=render();
 assert.equal(policies[0].name,'Unsaved name');
 nodes(tree).find(n=>n.type==='button'&&n.props.className==='pricing-button pricing-primary').props.onClick();tree=render();
 assert.equal(policies.length,3);assert.equal(editors(tree).length,1);assert.ok(control(tree,'Toggle policy 3'));
 control(tree,'Toggle policy 3').props.onClick();tree=render();assert.equal(policies[2].isActive,false);
 control(tree,'Delete policy 3').props.onClick();tree=render();assert.equal(policies.length,2);assert.equal(editors(tree).length,0);
 assert.equal(policies[0].name,'Unsaved name');
});

test('real-data pagination keeps selection and clamps after deletions; creation opens its last page',()=>{
 setup();policies=Array.from({length:12},(_,i)=>policy(`Policy ${i+1}`));let tree=render();
 assert.equal(rows(tree).length,5);assert.equal(control(tree,'Previous calendar policy page').props.disabled,true);
 rows(tree)[0].props.onClick();tree=render();
 control(tree,'Next calendar policy page').props.onClick();tree=render();assert.equal(rows(tree).length,5);
 assert.ok(control(tree,'Toggle policy Policy 1'));
 control(tree,'Next calendar policy page').props.onClick();tree=render();assert.equal(rows(tree).length,2);
 assert.equal(control(tree,'Next calendar policy page').props.disabled,true);
 nodes(tree).find(n=>n.type==='button'&&n.props.className==='pricing-button pricing-primary').props.onClick();tree=render();
 assert.equal(rows(tree).length,3);assert.ok(control(tree,'Toggle policy 13'));assert.equal(editors(tree).length,1);
 policies=policies.slice(0,4);tree=render();assert.equal(rows(tree).length,4);
 assert.equal(control(tree,'Calendar policy page 1').props['aria-current'],'page');
});
