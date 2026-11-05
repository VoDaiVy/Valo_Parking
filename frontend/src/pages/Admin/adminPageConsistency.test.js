import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
let server, hooks; const pages = {};
before(async () => {
  server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom', plugins: [{
    name: 'admin-consistency-fixtures', enforce: 'pre',
    resolveId(id) { if (id.startsWith('virtual:consistency-')) return '\0'+id; },
    load(id) {
      if (id==='\0virtual:consistency-hooks') return `export { Fragment } from 'react'; let states=[],cursor=0; export const seed=v=>{states=[...v];cursor=0;}; export const useState=initial=>{const i=cursor++; if(!(i in states)) states[i]=typeof initial==='function'?initial():initial; return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];}; export const useEffect=()=>{}; export const useMemo=fn=>fn(); export const useCallback=fn=>fn; export const useRef=value=>({current:value});`;
      if (id==='\0virtual:consistency-router') return `export const useSearchParams=()=>[new URLSearchParams(),()=>{}];`;
      if (id==='\0virtual:consistency-viewer') return 'export default ()=>null;';
    },
    transform(source,id) {
      if (!/\/(PolicyManagement|RevenueAnalytics|VoucherManagement|VehicleManagement)\.jsx$/.test(id.replaceAll('\\','/'))) return;
      return source.replace(/useReducedMotion(?=\s*[},])/g, 'useReducedMotion as unusedReducedMotion').replace(/import \{([^}]+)\} from 'framer-motion';/, (line) => line + '\nconst useReducedMotion = () => true;').replace("from 'react'","from 'virtual:consistency-hooks'").replace("from 'react-router-dom'","from 'virtual:consistency-router'").replace("from '../../components/CarViewer'","from 'virtual:consistency-viewer'");
    },
  }] });
  hooks=await server.ssrLoadModule('virtual:consistency-hooks');
  for (const name of ['PolicyManagement','RevenueAnalytics','VoucherManagement','VehicleManagement']) pages[name]=(await server.ssrLoadModule(`/src/pages/Admin/${name}.jsx`)).default;
});
after(async()=>{await server?.close();});
const nodes=node=>!node||typeof node!=='object'?[]:[node,...React.Children.toArray(node.props?.children).flatMap(nodes)];
const render=(name,state=[])=>{hooks.seed(state); return pages[name]();};
test('four headers retain their title, badge, controls and a single existing grid overlay',()=>{
  for (const [name,title,action] of [['PolicyManagement','Policies','Create New Policy'],['RevenueAnalytics','Revenue Analytics','Refresh'],['VoucherManagement','Voucher management','Add template'],['VehicleManagement','Vehicles &amp; 3D Models','Sync']]) {
    const tree=render(name); const html=renderToStaticMarkup(tree);
    assert.ok(html.includes(title)); assert.ok(html.includes(action));
    const line=nodes(tree).find(node=>node.props?.className==='c4-title-line');
    assert.ok(line); assert.equal(React.Children.toArray(line.props.children)[0].type,'h1');
    assert.equal(nodes(tree).filter(node=>typeof node.type==='function' && node.type.name==='AdminBackgroundOverlay').length,1);
  }
});
test('policy and voucher KPIs preserve real source counts and create actions',()=>{
  const policies=[{_id:'1',status:'published'},{_id:'2',status:'draft'},{_id:'3',status:'archived'}];
  const policy=render('PolicyManagement',[policies]);
  const strip=nodes(policy).find(node=>node.props?.className?.includes('c4-four'));
  const html=renderToStaticMarkup(strip);
  for(const label of ['Total Policies','Published','Drafts','Archived']) assert.ok(html.includes(label));
  assert.ok(html.includes('>3</span>'));
  const voucher=render('VoucherManagement',[[{_id:'1',name:'One',isActive:true,type:'PERCENT_DISCOUNT',pointCost:5,discountPercent:10},{_id:'2',name:'Two',isActive:false,type:'PERCENT_DISCOUNT',pointCost:5,discountPercent:10}],[],undefined,null,undefined,false]);
  const vstrip=nodes(voucher).find(node=>node.props?.className?.includes('c4-three'));
  const vhtml=renderToStaticMarkup(vstrip);
  for (const label of ['Total Templates','Active Rewards','Inactive']) assert.ok(vhtml.includes(label));
  assert.ok(vhtml.includes('>2</p>'));
  nodes(voucher).find(node=>node.type==='button' && renderToStaticMarkup(node).includes('Add template')).props.onClick();
});
test('scoped responsive rules keep currency on one line and provide 6/3/2/1-column layouts',()=>{
  const css=readFileSync(new URL('./adminPageConsistency.css',import.meta.url),'utf8');
  postcss.parse(css).walkRules(rule=>assert.ok(rule.selector.split(',\n').every(selector=>selector.trim().startsWith('body[data-valo-typography="admin"]'))));
  for(const value of ['repeat(6, minmax(0, 1fr))','repeat(3, minmax(0, 1fr))','repeat(2, minmax(0, 1fr))','grid-template-columns: minmax(0, 1fr)','white-space: nowrap','overflow-wrap: normal']) assert.ok(css.includes(value));
});
