import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
let server, hooks, api; const pages = {};
before(async () => {
  server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom', plugins: [{
    name: 'admin-consistency-fixtures', enforce: 'pre',
    resolveId(id) { if (id.startsWith('virtual:consistency-')) return '\0'+id; },
    load(id) {
      if (id==='\0virtual:consistency-hooks') return `export { Fragment } from 'react'; let states=[],cursor=0; export const seed=v=>{states=[...v];cursor=0;}; export const rewind=()=>{cursor=0;}; export const snapshot=()=>states; export const useState=initial=>{const i=cursor++; if(!(i in states)) states[i]=typeof initial==='function'?initial():initial; return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];}; export const useEffect=()=>{}; export const useMemo=fn=>fn(); export const useCallback=fn=>fn; export const useRef=value=>({current:value});`;
      if (id==='\0virtual:consistency-voucherapi') return `export const calls=[]; const ok=(...args)=>{calls.push(args); return Promise.resolve({ok:true,data:{data:[]}});}; export const createVoucherTemplate=(...a)=>ok('create',...a); export const updateVoucherTemplate=(...a)=>ok('update',...a); export const deactivateVoucherTemplate=(...a)=>ok('deactivate',...a); export const deleteVoucherTemplate=(...a)=>ok('delete',...a); export const getVoucherTemplatesAdmin=()=>ok('list');`;
      if (id==='\0virtual:consistency-router') return `export const useSearchParams=()=>[new URLSearchParams(),()=>{}];`;
      if (id==='\0virtual:consistency-viewer') return 'export default ()=>null;';
    },
    transform(source,id) {
      if (!/\/(PolicyManagement|RevenueAnalytics|VoucherManagement|VehicleManagement)\.jsx$/.test(id.replaceAll('\\','/'))) return;
      return source.replace(/useReducedMotion(?=\s*[},])/g, 'useReducedMotion as unusedReducedMotion').replace(/import \{([^}]+)\} from 'framer-motion';/, (line) => line + '\nconst useReducedMotion = () => true;').replace("from '../../services/loyaltyService'", "from 'virtual:consistency-voucherapi'").replace("from 'react'","from 'virtual:consistency-hooks'").replace("from 'react-router-dom'","from 'virtual:consistency-router'").replace("from '../../components/CarViewer'","from 'virtual:consistency-viewer'");
    },
  }] });
  hooks=await server.ssrLoadModule('virtual:consistency-hooks');
  api=await server.ssrLoadModule('virtual:consistency-voucherapi');
  for (const name of ['VoucherManagement']) pages[name]=(await server.ssrLoadModule(`/src/pages/Admin/${name}.jsx`)).default;
});
after(async()=>{await server?.close();});
const nodes=node=>!node||typeof node!=='object'?[]:[node,...React.Children.toArray(node.props?.children).flatMap(nodes)];

const records=Array.from({length:19},(_,i)=>({_id:String(i+1), name:`Reward ${String(i+1).padStart(2,'0')}`, description:i%2?'Weekend parking':'Weekday parking', isActive:i<12, type:'PERCENT_DISCOUNT',pointCost:i+1, discountPercent:10, createdAt:new Date(2026,0,i+1).toISOString()}));
function seed(items=records,page=1) {
 hooks.seed([]); rerender(); const state=[...hooks.snapshot()];
 state[0]=items; state[5]=false; state[13]=page; hooks.seed(state); api.calls.length=0;
 return rerender();
}
function rerender(){hooks.rewind();return pages.VoucherManagement();}
const rows=tree=>nodes(tree).filter(n=>n.type==='article' && n.props.className?.includes('voucher-row'));
const control=(tree,label)=>nodes(tree).find(n=>n.props?.['aria-label']===label);
const select=(tree,label)=>nodes(tree).find(n=>n.props?.ariaLabel===label);
const markup=tree=>renderToStaticMarkup(tree);

test('real records paginate with bounded controls and newest ordering',()=>{
 let tree=seed(); assert.equal(rows(tree).length,8); assert.ok(markup(rows(tree)[0]).includes('Reward 19'));
 assert.equal(control(tree,'Previous voucher page').props.disabled,true);
 control(tree,'Next voucher page').props.onClick(); tree=rerender(); assert.equal(rows(tree).length,8);
 control(tree,'Next voucher page').props.onClick(); tree=rerender(); assert.equal(rows(tree).length,3);
 assert.equal(control(tree,'Next voucher page').props.disabled,true);
 assert.ok(markup(tree).includes('17\u201319 of 19 results'));
});

test('name/description search, status and sorting combine and reset pagination',()=>{
 let tree=seed(records,3);
 control(tree,'Search vouchers').props.onChange({target:{value:' WEEKEND '}}); tree=rerender();
 assert.equal(hooks.snapshot()[13],1); assert.ok(markup(tree).includes('of 9 results'));
 select(tree,'Filter vouchers by status').props.onChange('active'); tree=rerender();
 assert.equal(rows(tree).length,6);
 select(tree,'Sort vouchers').props.onChange('points-low'); tree=rerender();
 assert.ok(markup(rows(tree)[0]).includes('Reward 02'));
 select(tree,'Sort vouchers').props.onChange('oldest'); tree=rerender(); assert.ok(markup(rows(tree)[0]).includes('Reward 02'));
 select(tree,'Sort vouchers').props.onChange('points-high'); tree=rerender(); assert.ok(markup(rows(tree)[0]).includes('Reward 12'));
 control(tree,'Search vouchers').props.onChange({target:{value:'Reward 04'}}); tree=rerender(); assert.equal(rows(tree).length,1);
 select(tree,'Filter vouchers by status').props.onChange('inactive'); tree=rerender();
 assert.equal(rows(tree).length,0); assert.ok(markup(tree).includes('No vouchers match your filters'));
 assert.equal(control(tree,'Next voucher page').props.disabled,true);
 const kpis=nodes(tree).find(n=>n.props.className?.includes('c4-three'));
 const html=markup(kpis); for(const value of [19,12,7]) assert.ok(html.includes(`>${value}</p>`));
});

test('empty and shortened datasets keep pagination valid; sorting does not mutate source',()=>{
 const tree=seed(records.slice(0,9),3); assert.equal(rows(tree).length,1);
 assert.equal(control(tree,'Voucher page 2').props['aria-current'],'page'); assert.equal(records[0]._id,'1');
 const empty=seed([]); assert.equal(rows(empty).length,0); assert.ok(markup(empty).includes('No reward templates yet'));
 assert.equal(control(empty,'Previous voucher page').props.disabled,true); assert.equal(control(empty,'Next voucher page').props.disabled,true);
});

test('edit opens original values; status and delete retain their API and confirmation flows',async()=>{
 let tree=seed(); control(tree,'Edit Reward 19').props.onClick(); rerender();
 assert.equal(hooks.snapshot()[2]._id,'19'); assert.equal(hooks.snapshot()[4].pointCost,19);
 tree=seed(); await control(tree,'Activate Reward 19').props.onClick();
 assert.deepEqual(api.calls[0],['update','19',{isActive:true}]);
 tree=seed(); await control(tree,'Deactivate Reward 12').props.onClick();
 assert.deepEqual(api.calls[0],['deactivate','12']);
 tree=seed(); control(tree,'Delete Reward 19').props.onClick(); tree=rerender();
 assert.ok(nodes(tree).some(n=>n.props.role==='alertdialog')); assert.equal(api.calls.length,0);
 const confirm=nodes(tree).find(n=>n.type==='button' && markup(n).includes('Delete</button>'));
 await confirm.props.onClick(); assert.deepEqual(api.calls[0],['delete','19']);
});

test('create dialog keeps defaults, live preview, notification opt-in and original numeric payload',async()=>{
 let tree=seed();
 nodes(tree).find(n=>n.type==='button' && markup(n).includes('Add template')).props.onClick(); tree=rerender();
 const dialog=nodes(tree).find(n=>n.type==='form' && n.props.role==='dialog');
 assert.ok(dialog); assert.ok(markup(dialog).includes('Create voucher'));
 assert.equal(nodes(dialog).find(n=>n.props.role==='switch').props['aria-checked'],false);
 assert.ok(markup(dialog).includes('Untitled reward'));
 const name=nodes(dialog).find(n=>n.type==='input' && n.props.placeholder==='e.g. Weekend 15% off');
 name.props.onChange({target:{value:'Weekend special'}}); tree=rerender();
 assert.ok(markup(nodes(tree).find(n=>n.props.className?.includes('voucher-modal-preview'))).includes('Weekend special'));
 const state=[...hooks.snapshot()]; state[4]={...state[4],pointCost:'45',discountPercent:'15'}; hooks.seed(state); tree=rerender();
 await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 const payload=api.calls.find(c=>c[0]==='create')[1];
 assert.equal(payload.pointCost,45); assert.equal(payload.discountPercent,15);
 assert.equal(payload.redemptionLimit,null); assert.equal(payload.notifyCustomers,false);
 assert.equal(payload.serviceId,null);
});

test('free-service validation remains readable inside the dialog and edit retains limit minimum',async()=>{
 let tree=seed(); nodes(tree).find(n=>n.type==='button' && markup(n).includes('Add template')).props.onClick(); tree=rerender();
 select(tree,'Select reward type').props.onChange('FREE_SERVICE'); tree=rerender();
 assert.ok(select(tree,'Select included service'));
 await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}}); tree=rerender();
 const dialog=nodes(tree).find(n=>n.props.role==='dialog');
 assert.ok(markup(dialog).includes('Select an active service for this voucher.'));
 assert.equal(api.calls.length,0);
 control(tree,'Close dialog').props.onClick(); tree=rerender(); assert.ok(!nodes(tree).some(n=>n.props.role==='dialog'));
 tree=seed([{...records[0],redeemedCount:4,redemptionLimit:10}]);
 control(tree,'Edit Reward 01').props.onClick(); tree=rerender();
 const edit=nodes(tree).find(n=>n.props.role==='dialog');
 assert.ok(markup(edit).includes('Edit voucher')); assert.ok(!nodes(edit).some(n=>n.props.role==='switch'));
 assert.equal(nodes(edit).find(n=>n.type==='input' && n.props.placeholder==='Unlimited').props.min,4);
 await edit.props.onSubmit({preventDefault(){}});
 assert.equal(api.calls[0][0],'update'); assert.equal(api.calls[0][1],'1');
 assert.equal(api.calls[0][2].redemptionLimit,10);
});

test('row click and keyboard open populated detail modal; row actions stay independent; outside click closes',()=>{
 let tree=seed();
 rows(tree)[0].props.onClick({target:{closest:()=>null}}); tree=rerender();
 assert.equal(hooks.snapshot()[2]._id,'19'); assert.ok(markup(tree).includes('Edit voucher'));
 let backdrop=nodes(tree).find(n=>n.props.className?.includes('voucher-modal-backdrop'));
 const outside={}; backdrop.props.onClick({target:outside,currentTarget:outside}); tree=rerender();
 assert.ok(!nodes(tree).some(n=>n.props.role==='dialog'));
 rows(tree)[0].props.onClick({target:{closest:()=>({})}}); rerender(); assert.equal(hooks.snapshot()[2],undefined);
 const row={}; rows(tree)[0].props.onKeyDown({target:row,currentTarget:row,key:'Enter',preventDefault(){}}); tree=rerender();
 assert.equal(hooks.snapshot()[2]._id,'19');
 backdrop=nodes(tree).find(n=>n.props.className?.includes('voucher-modal-backdrop'));
 backdrop.props.onClick({target:{},currentTarget:{}}); rerender(); assert.equal(hooks.snapshot()[2]._id,'19');
 const state=[...hooks.snapshot()]; state[6]=true; hooks.seed(state); tree=rerender();
 backdrop=nodes(tree).find(n=>n.props.className?.includes('voucher-modal-backdrop'));
 backdrop.props.onClick({target:outside,currentTarget:outside}); rerender(); assert.equal(hooks.snapshot()[2]._id,'19');
});
