import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
let server, hooks; const pages = {};
before(async () => {
  server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom', plugins: [{
    name: 'admin-consistency-fixtures', enforce: 'pre',
    resolveId(id) { if (id.startsWith('virtual:consistency-')) return '\0'+id; },
    load(id) {
      if (id==='\0virtual:consistency-hooks') return `export { Fragment } from 'react'; let states=[],cursor=0; export const seed=v=>{states=[...v];cursor=0;}; export const rewind=()=>{cursor=0;}; export const snapshot=()=>states; export const useState=initial=>{const i=cursor++; if(!(i in states)) states[i]=typeof initial==='function'?initial():initial; return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];}; export const useEffect=()=>{}; export const useMemo=fn=>fn(); export const useCallback=fn=>fn; export const useRef=value=>({current:value});`;
      if (id==='\0virtual:consistency-router') return `export const useSearchParams=()=>[new URLSearchParams(),()=>{}];`;
      if (id==='\0virtual:consistency-viewer') return 'export default ()=>null;';
    },
    transform(source,id) {
      if (!/\/(PolicyManagement|RevenueAnalytics|VoucherManagement|VehicleManagement)\.jsx$/.test(id.replaceAll('\\','/'))) return;
      return source.replace(/useReducedMotion(?=\s*[},])/g, 'useReducedMotion as unusedReducedMotion').replace(/import \{([^}]+)\} from 'framer-motion';/, (line) => line + '\nconst useReducedMotion = () => true;').replace("from 'react'","from 'virtual:consistency-hooks'").replace("from 'react-router-dom'","from 'virtual:consistency-router'").replace("from '../../components/CarViewer'","from 'virtual:consistency-viewer'");
    },
  }] });
  hooks=await server.ssrLoadModule('virtual:consistency-hooks');
  for (const name of ['PolicyManagement']) pages[name]=(await server.ssrLoadModule(`/src/pages/Admin/${name}.jsx`)).default;
});
after(async()=>{await server?.close();});
const nodes=node=>!node||typeof node!=='object'?[]:[node,...React.Children.toArray(node.props?.children).flatMap(nodes)];

const records=Array.from({length:12},(_,i)=>({_id:String(i+1),title:`Policy ${String(i+1).padStart(2,'0')}`,slug:`policy-${i+1}`,status:i<7?'published':'draft',currentVersionNumber:i+1}));
function seed(items=records,page=1) {
  hooks.seed([]); rerender();
  const state=[...hooks.snapshot()]; state[0]=items; state[1]='1'; state[8]=false; state[17]='title'; state[18]='versions'; state[23]=page;
  hooks.seed(state); return rerender();
}
function rerender(){hooks.rewind(); return pages.PolicyManagement();}
const rows=tree=>nodes(tree).filter(n=>n.type==='button' && n.props.className?.includes('policy-list-row'));
const control=(tree,label)=>nodes(tree).find(n=>n.props?.['aria-label']===label);
test('five real policies per page, final partial page, bounded navigation and selected policy retained',()=>{
  let tree=seed(); assert.equal(rows(tree).length,5); assert.equal(rows(tree)[0].props['aria-pressed'],true);
  assert.equal(control(tree,'Previous policy page').props.disabled,true);
  control(tree,'Next policy page').props.onClick(); tree=rerender(); assert.equal(rows(tree).length,5);
  assert.ok(renderToStaticMarkup(rows(tree)[0]).includes('Policy 06')); assert.equal(hooks.snapshot()[1],'1'); assert.equal(hooks.snapshot()[18],'versions');
  control(tree,'Next policy page').props.onClick(); tree=rerender(); assert.equal(rows(tree).length,2); assert.equal(control(tree,'Next policy page').props.disabled,true);
  assert.equal(control(tree,'Policy page 3').props['aria-current'],'page');
  control(tree,'Policy page 1').props.onClick(); tree=rerender(); assert.equal(rows(tree)[0].props['aria-pressed'],true);
});
test('search, status and sorting reset only list pagination and use the filtered dataset',()=>{
  let tree=seed(records,3);
  nodes(tree).find(n=>n.type==='input' && n.props.placeholder?.startsWith('Search policies')).props.onChange({target:{value:'Policy 12'}});
  tree=rerender(); assert.equal(rows(tree).length,1); assert.ok(renderToStaticMarkup(rows(tree)[0]).includes('Policy 12')); assert.equal(hooks.snapshot()[23],1); assert.equal(hooks.snapshot()[1],'1'); assert.equal(hooks.snapshot()[18],'versions');
  tree=seed(records,3); nodes(tree).find(n=>n.props?.ariaLabel==='Filter policies by status').props.onChange('draft');
  tree=rerender(); assert.equal(rows(tree).length,5); assert.ok(rows(tree).every(n=>renderToStaticMarkup(n).includes('draft'))); assert.equal(hooks.snapshot()[23],1);
  tree=seed(records,3); nodes(tree).find(n=>n.props?.ariaLabel==='Sort policies').props.onChange('version'); tree=rerender(); assert.ok(renderToStaticMarkup(rows(tree)[0]).includes('Policy 12')); assert.equal(hooks.snapshot()[23],1);
});
test('row selection keeps the original detail selection and overview behavior; plus opens creation',()=>{
  let tree=seed(records,2); rows(tree)[1].props.onClick(); tree=rerender(); assert.equal(hooks.snapshot()[1],'7'); assert.equal(hooks.snapshot()[18],'overview'); assert.equal(rows(tree)[1].props['aria-pressed'],true);
  control(tree,'Create policy').props.onClick(); rerender(); assert.equal(hooks.snapshot()[4],true); assert.equal(hooks.snapshot()[1],''); assert.equal(hooks.snapshot()[18],'draft');
});
test('empty results disable both controls; a shortened dataset clamps the current page',()=>{
  let tree=seed([],3); assert.equal(rows(tree).length,0); assert.equal(control(tree,'Previous policy page').props.disabled,true); assert.equal(control(tree,'Next policy page').props.disabled,true);
  tree=seed(records.slice(0,6),3); assert.equal(rows(tree).length,1); assert.equal(control(tree,'Policy page 2').props['aria-current'],'page');
});

test('empty workspace retains records, pagination and a keyboard-accessible list region',()=>{
  const tree=seed(records.slice(0,4));
  const list=control(tree,'Policy List');
  assert.equal(rows(tree).length,4);
  assert.ok(!list.props.className.includes('self-start'));
  const region=control(tree,'Policy records');
  assert.equal(region.props.tabIndex,0);
  assert.equal(region.props.role,'region');
  assert.ok(!list.props.className.includes('min-h-'));
  const html=renderToStaticMarkup(tree);
  assert.ok(html.includes('No Policy Selected'));
  assert.ok(html.includes('policy-list-pagination'));
  assert.ok(!html.includes('min-h-[620px]'));
  assert.ok(!html.includes('min-h-[520px]'));
  assert.ok(!html.includes('overflow-y-auto'));
});
