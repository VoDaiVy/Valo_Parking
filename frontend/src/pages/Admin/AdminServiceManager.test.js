import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
let server, hooks, Component, api;
before(async () => {
  server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom', plugins: [{
    name: 'service-ui-fixture', enforce: 'pre',
    resolveId(id) { if (id.startsWith('virtual:service-ui-')) return '\0' + id; },
    load(id) {
      if (id === '\0virtual:service-ui-hooks') return `export { Fragment } from 'react'; let values=[], cursor=0; export const seed=v=>{values=[...v]}; export const begin=()=>{cursor=0}; export const get=()=>values; export const useState=initial=>{const i=cursor++; if(!(i in values)) values[i]=typeof initial==='function'?initial():initial; return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}];}; export const useEffect=()=>{}; export const useMemo=fn=>fn(); export const useRef=v=>({current:v});`;
      if (id === '\0virtual:service-ui-api') return `export const calls=[]; const ok={ok:true,data:{success:true,data:[]}}; export const getServices=async(activeOnly)=>{calls.push(['get',activeOnly]); return ok}; export const createService=async data=>{calls.push(['create',data]);return ok}; export const updateService=async(id,data)=>{calls.push(['update',id,data]);return ok}; export const deleteService=async id=>{calls.push(['delete',id]);return ok};`;
    },
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/pages/Admin/AdminServiceManager.jsx')) return;
      return source.replace("from 'react'", "from 'virtual:service-ui-hooks'").replace("from '../../services/extraServiceApi'", "from 'virtual:service-ui-api'");
    },
  }] });
  hooks = await server.ssrLoadModule('virtual:service-ui-hooks');
  api = await server.ssrLoadModule('virtual:service-ui-api');
  Component = (await server.ssrLoadModule('/src/pages/Admin/AdminServiceManager.jsx')).default;
});
after(async () => { await server?.close(); });
const services = Array.from({ length: 16 }, (_, i) => ({ _id: `service-${i}`, name: `Service ${i}`, description: `Description ${i}`, price: (i + 1) * 1000, timeCost: 30, isActive: i % 2 === 0, imageUrl: '/image.png', createdAt: new Date(2026, 9, i + 1).toISOString() }));
const seed = (overrides = {}) => {
  const state = [services, false, '', 'all', 'newest', 1, false, false, false, null, null, { name: '', description: '', price: '', timeCost: '30', isActive: true }, null, '', '', false];
  for (const [key, value] of Object.entries(overrides)) state[key] = value;
  hooks.seed(state);
};
const render = () => { hooks.begin(); return Component(); };
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
const text = node => typeof node === 'object' ? React.Children.toArray(node?.props?.children).map(text).join('') : String(node ?? '');
const rows = tree => nodes(tree).filter(node => node.props?.className === 'services-row');
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node).includes(label));
test('service table retains source data, four full-list metrics and ten-row pagination', () => {
  seed(); let tree = render();
  assert.equal(rows(tree).length, 10);
  const metrics = nodes(tree).filter(node => typeof node.type === 'function' && node.type.name === 'StatCard');
  assert.deepEqual(metrics.map(node => [node.props.label, node.props.value]), [['Total Services',16],['Active Services',8],['Inactive Services',8],['Average Price',8500]]);
  const html = renderToStaticMarkup(tree);
  for (const label of ['Service', 'Price', 'Duration', 'Status', 'Actions', 'View Panel']) assert.ok(html.includes(label));
  assert.ok(!html.includes('Description 15'));
  button(tree, 'Next').props.onClick(); tree = render(); assert.equal(rows(tree).length, 6);
  assert.ok(text(tree).includes('Page 2 of 2'));
  nodes(tree).find(node=>node.type==='input').props.onChange({target:{value:'Service 15'}});
  tree = render(); assert.equal(rows(tree).length, 1); assert.ok(text(tree).includes('Page 1 of 1'));
});
test('View Panel keeps description, edit settings and status form handling', () => {
  seed(); let tree = render();
  rows(tree)[0].props.onClick(); tree = render();
  assert.ok(renderToStaticMarkup(tree).includes('Description 15'));
  button(tree, 'Edit Settings').props.onClick(); tree = render();
  assert.ok(text(tree).includes('Edit Service'));
  const checkbox = nodes(tree).find(node => node.type==='input' && node.props.name==='name');
  checkbox.props.onChange({target:{name:'name',value:'Updated Service',type:'text'}});
  tree = render(); assert.equal(nodes(tree).find(node=>node.type==='input' && node.props.name==='name').props.value,'Updated Service');
});
test('existing validation, update payload and delete API callbacks remain intact', async () => {
  seed({6:true}); let tree = render();
  await nodes(tree).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(hooks.get()[14],'Service name must be at least 3 characters.');
  seed({6:true,9:services[0],11:{name:'Updated Service',description:'Valid description',price:2000,timeCost:45,isActive:false}});
  tree=render(); api.calls.length=0;
  await nodes(tree).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
  const update=api.calls.find(call=>call[0]==='update');
  assert.equal(update[1],'service-0'); assert.equal(update[2].get('isActive'),'false'); assert.equal(update[2].get('timeCost'),'45');
  seed(); tree=render();
  nodes(rows(tree)[0]).find(node=>node.props?.['aria-label']==='Delete Service 15').props.onClick();
  tree=render(); await button(tree,'Delete').props.onClick();
  assert.ok(api.calls.some(call=>call[0]==='delete' && call[1]==='service-15'));
});

test('flat Service Profile preserves image, real fields, close and delete confirmation', () => {
  seed(); let tree = render(); rows(tree)[0].props.onClick(); tree = render();
  const profile = nodes(tree).find(node => node.props?.className?.startsWith('service-profile absolute'));
  assert.equal(profile.props.role, 'dialog');
  const html = renderToStaticMarkup(profile);
  for (const value of ['Service 15', 'Description 15', '16.000', '30', 'Inactive', 'Added Date']) assert.ok(html.includes(value));
  assert.equal(nodes(profile).find(node => node.type === 'img').props.src, services[15].imageUrl);
  assert.ok(!html.includes('gradient'));
  assert.ok(!html.includes('blur'));
  button(profile, 'Delete').props.onClick();
  assert.equal(hooks.get()[8], true);
  assert.equal(hooks.get()[9]._id, 'service-15');
  nodes(profile).find(node => node.props?.['aria-label'] === 'Close Service Profile').props.onClick();
  assert.equal(hooks.get()[7], false);
});
