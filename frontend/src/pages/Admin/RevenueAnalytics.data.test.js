import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {motion} from 'framer-motion';
import {transformWithOxc} from 'vite';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {inspectRevenueResponse, readRevenueNumber} from './revenueAnalyticsData.js';

const fixture = () => ({
  summary:{totalRevenue:145000,bookingRevenue:70000,serviceRevenue:20000,packageRevenue:50000,membershipTransferFees:5000,refunds:10000,sourceCompositionTotal:145000},
  trend:[{period:'2026-10-20',totalRevenue:145000,bookingRevenue:70000,serviceRevenue:20000,packageRevenue:50000,membershipTransferFees:5000,refunds:10000}],
  packageBreakdown:[{packageId:'package-1',packageName:'Fixture Monthly',packageType:'monthly',isActive:true,totalAmount:50000,purchaseAmount:25000,renewalAmount:25000,purchaseCount:1,renewalCount:1}],
});
test('numeric validation separates unavailable money from actual zero',()=>{
  for(const value of [null,undefined,'', ' ',NaN,Infinity,-1,{},[],true]) assert.equal(readRevenueNumber(value),null);
  assert.equal(readRevenueNumber(0),0); assert.equal(readRevenueNumber('0'),0); assert.equal(readRevenueNumber(12500),12500);
});
test('reported net sources reconcile without subtracting refunds twice or mutating API data',()=>{
  const data=fixture(); const original=structuredClone(data); const result=inspectRevenueResponse(data);
  assert.deepEqual(result.issues,[]); assert.equal(result.summary.totalRevenue,145000); assert.equal(result.summary.refunds,10000);
  assert.equal(result.packages[0].purchaseCount,1); assert.equal(result.packages[0].renewalCount,1); assert.deepEqual(data,original);
});
test('inconsistent summary suppresses total/composition; inconsistent trend and package rows are unavailable',()=>{
  const data=fixture(); data.summary.totalRevenue=999999;
  const result=inspectRevenueResponse(data); assert.equal(result.summary.totalRevenue,null); assert.equal(result.summary.sourceCompositionTotal,null); assert.ok(result.issues.length);
  const trend=fixture(); trend.trend[0].bookingRevenue=10; assert.equal(inspectRevenueResponse(trend).trend,null);
  const mismatch=fixture(); mismatch.trend[0]={...mismatch.trend[0],totalRevenue:145001,bookingRevenue:70001}; assert.equal(inspectRevenueResponse(mismatch).trend,null);
  const packages=fixture(); packages.packageBreakdown[0].totalAmount=100; assert.equal(inspectRevenueResponse(packages).packages,null);
});
test('genuine empty reports remain zero while missing fields remain unavailable',()=>{
  const data=fixture(); for(const key of Object.keys(data.summary)) data.summary[key]=0;
  data.trend=[]; data.packageBreakdown=[]; const zero=inspectRevenueResponse(data);
  assert.deepEqual(zero.issues,[]); assert.equal(zero.summary.totalRevenue,0);
  const missing=inspectRevenueResponse({}); assert.equal(missing.summary.totalRevenue,null); assert.equal(missing.trend,null); assert.equal(missing.packages,null);
});
test('missing and malformed counts or amounts do not become package attribution',()=>{
  const data=fixture(); delete data.packageBreakdown[0].renewalCount; assert.equal(inspectRevenueResponse(data).packages,null);
  const fraction=fixture(); fraction.packageBreakdown[0].purchaseCount=.5; assert.equal(inspectRevenueResponse(fraction).packages,null);
});

// Render real chart/table components; fixtures are confined to this test module.
const source=readFileSync(new URL('./RevenueAnalytics.jsx',import.meta.url),'utf8');
const script=source.slice(source.indexOf('const MODE_OPTIONS')).replace('export default function RevenueAnalytics','function RevenueAnalytics');
const compiled=await transformWithOxc(script,'RevenueTest.jsx',{jsx:{runtime:'classic'}});
const icons=['AlertCircle','ArrowDownRight','BarChart3','CalendarDays','Check','ChevronDown','CircleDollarSign','Crown','RefreshCw','Repeat','WalletCards','Wrench'];
const Icon=()=>React.createElement('svg',{'aria-hidden':true});
const make=(runtime=React, api=()=>Promise.resolve({ok:false}))=>new Function('React','motion','inspectRevenueResponse','getAdminPlatformRevenueByMode','useReducedMotion','Menu','Listbox','Transition',...icons,`const {Fragment,useState,useEffect}=React; ${compiled.code}; return {RevenueAnalytics,RevenueTrendChart,RevenueBySourceSection,PackageValueSection,StatusDistributionSection,RecentRevenueTransactions,KPIStrip};`)(runtime,motion,inspectRevenueResponse,api,()=>true,()=>null,{Button:()=>null,Options:()=>null,Option:()=>null},()=>null,...icons.map(()=>Icon));
const components=make();
const render=(name,props={})=>renderToStaticMarkup(React.createElement(components[name],{reduceMotion:true,...props}));
test('all six KPIs render reported values and do not display invented growth percentages',()=>{
  const html=render('KPIStrip',{summary:fixture().summary});
  for(const value of ['Total Revenue','Booking Revenue','Service Revenue','Package Revenue','Transfer Fees','Refunds','145.000 VND','10.000 VND']) assert.ok(html.includes(value));
  assert.ok(!html.includes('%')); const missing=render('KPIStrip',{summary:{}}); assert.ok(missing.includes('Unavailable')); assert.ok(!missing.includes('0 VND'));
});
test('gold bars reflect only the two actual nonzero dates without interpolation; zero and missing differ',()=>{
  const point=fixture().trend[0]; const trend=[point,{...point,period:'2026-10-21',totalRevenue:0,bookingRevenue:0,serviceRevenue:0,packageRevenue:0,membershipTransferFees:0,refunds:0},{...point,period:'2026-10-22'}];
  const html=render('RevenueTrendChart',{trend,granularity:'day'});
  assert.equal((html.match(/data-series="totalRevenue"/g)||[]).length,2);
  assert.ok(html.includes('data-amount="145000"')); assert.ok(html.includes('url(#ra-revenue-totalRevenue)')); assert.ok(html.includes('stop-opacity=".18"'));
  assert.ok(render('RevenueTrendChart',{trend:null,granularity:'day'}).includes('unavailable'));
  assert.ok(render('RevenueTrendChart',{trend:[],granularity:'day'}).includes('No revenue recorded'));
});
test('source donut uses four positive sources, exact percentages, and no refund revenue slice',()=>{
  const html=render('RevenueBySourceSection',{summary:fixture().summary});
  assert.equal((html.match(/stroke-dasharray=/g)||[]).length,4);
  assert.ok(html.includes('48.3%')); assert.ok(!html.includes('Refunds</span>'));
  const bad=render('RevenueBySourceSection',{summary:{...fixture().summary,sourceCompositionTotal:null}}); assert.ok(bad.includes('unavailable'));
});
test('package table uses all actual rows, real ranking, purchase/renewal counts and package share',()=>{
  const rows=[fixture().packageBreakdown[0],{...fixture().packageBreakdown[0],packageId:'package-2',packageName:'Larger Actual Package',totalAmount:100000,purchaseAmount:100000,renewalAmount:0,purchaseCount:2,renewalCount:0}];
  const html=render('PackageValueSection',{packageBreakdown:rows});
  assert.ok(html.includes('<table>')); assert.ok(html.indexOf('Larger Actual Package')<html.indexOf('Fixture Monthly')); assert.ok(html.includes('66.7%'));
  for(const label of ['Type','Purchases','Renewals','Revenue','Share']) assert.ok(html.includes(label));
});
test('status distribution keeps paid, active, paused and cancelled distinct; missing is not empty',()=>{
  const html=render('StatusDistributionSection',{statusDistribution:{totalBookings:12,byStatus:[{status:'PAID',count:1},{status:'ACTIVE',count:1},{status:'PAUSED',count:1},{status:'CANCELLED',count:9}]}});
  for(const label of ['Paid','Active','Paused','Cancelled','75.0%']) assert.ok(html.includes(label));
  assert.ok(render('StatusDistributionSection',{statusDistribution:null}).includes('unavailable'));
});
test('transaction table explicitly unavailable instead of fabricating Paid rows or sample references',()=>{
  const html=render('RecentRevenueTransactions');
  for(const label of ['Date &amp; Time','Type','Reference','Description','Amount','Status','Payment Method','Unavailable']) assert.ok(html.includes(label));
  assert.ok(!html.includes('PKG-20261022-001')); assert.ok(!html.includes('>Paid<'));
});
test('API consumption preserves all date modes and success-only fetch timestamp',async()=>{
  const calls=[]; let states; let cursor; let effects;
  const runtime={...React,useState(initial){const key=cursor++; if(!(key in states)) states[key]=typeof initial==='function'?initial():initial; return [states[key],next=>{states[key]=typeof next==='function'?next(states[key]):next;}];},useEffect(fn){effects.push(fn);}};
  const exports=make(runtime,(params)=>{calls.push(params); return Promise.resolve({ok:true,data:{success:true,data:fixture()}});});
  for(const [mode,expected] of [['7d',{mode:'7d'}],['month',{mode:'month',year:'2026',month:'10'}],['quarter',{mode:'quarter',year:'2026',quarter:'4'}],['year',{mode:'year',year:'2026'}],['years',{mode:'years'}]]) {
    states=[mode,2026,10,4,0,true,null,'',null]; cursor=0; effects=[];
    exports.RevenueAnalytics(); effects[0](); await Promise.resolve();
    assert.deepEqual(calls.at(-1),expected); assert.ok(states[8] instanceof Date); assert.equal(states[5],false);
  }
});
test('all new visual rules require Admin role and Revenue Analytics page scope',()=>{
  const css=postcss.parse(readFileSync(new URL('revenueAnalytics.css',import.meta.url),'utf8'));
  css.walkRules(rule=>selectorParser(root=>root.each(selector=>assert.ok(selector.toString().trim().startsWith('body[data-valo-typography="admin"] .admin-revenue-analytics')))).processSync(rule.selector));
  assert.ok(css.toString().includes('prefers-reduced-motion: reduce'));
});

test('Revenue Trend switches total bars to true source stacks and mode-specific tooltips without API calls', () => {
  const states = ['total', null]; let cursor = 0; let requests = 0;
  const runtime = {...React, useState(initial) { const index=cursor++; if (!(index in states)) states[index]=initial; return [states[index], value=>{states[index]=value;}]; }};
  const Chart = make(runtime, () => { requests++; }).RevenueTrendChart;
  const walk = node => !node || typeof node !== 'object' ? [] : [node,...React.Children.toArray(node.props?.children).flatMap(walk)];
  const data=fixture(); const original=structuredClone(data);
  let props={trend:data.trend,granularity:'day',reduceMotion:true};
  const tree=()=>{cursor=0; return Chart(props);};
  const nodes=()=>walk(tree());
  const bars=()=>nodes().filter(node=>node.type==='rect' && node.props['data-series']);
  const toggle=label=>nodes().find(node=>node.type==='button' && node.props.children===label).props.onClick();
  const focus=()=>nodes().find(node=>node.type==='rect' && node.props.onFocus).props.onFocus();
  const tooltip=()=>nodes().find(node=>node.props?.role==='tooltip');
  assert.equal(bars().length,1); assert.equal(bars()[0].props['data-amount'],145000);
  focus(); let html=renderToStaticMarkup(tooltip());
  assert.ok(html.includes('20 Oct 2026')); assert.ok(html.includes('145.000 VND'));
  assert.ok(!html.includes('Refunds')); assert.ok(!html.includes('Booking'));
  for(let iteration=0;iteration<3;iteration++) {
    toggle('By Source'); const segments=bars();
    assert.equal(segments.length,4);
    assert.deepEqual(segments.map(node=>node.props['data-series']),['bookingRevenue','serviceRevenue','packageRevenue','membershipTransferFees']);
    assert.equal(new Set(segments.map(node=>node.props.x)).size,1);
    assert.equal(new Set(segments.map(node=>node.props.width)).size,1);
    assert.equal(segments.reduce((sum,node)=>sum+node.props['data-amount'],0),145000);
    for(let index=1;index<segments.length;index++) assert.ok(Math.abs(segments[index].props.y+segments[index].props.height-segments[index-1].props.y)<.001);
    focus(); html=renderToStaticMarkup(tooltip());
    for(const value of ['70.000 VND','20.000 VND','50.000 VND','5.000 VND','10.000 VND','145.000 VND','Refunds (already deducted)']) assert.ok(html.includes(value));
    assert.ok(nodes().some(node=>node.props?.['aria-label']==='Revenue sources'));
    toggle('Total'); assert.equal(bars().length,1); assert.equal(tooltip(),undefined);
  }
  toggle('By Source');
  props={...props,trend:[{period:'2026-10-22',totalRevenue:50000,bookingRevenue:0,serviceRevenue:0,packageRevenue:50000,membershipTransferFees:0,refunds:0}]};
  assert.equal(bars().length,1); assert.equal(bars()[0].props['data-series'],'packageRevenue');
  focus(); html=renderToStaticMarkup(tooltip()); assert.ok(html.includes('22 Oct 2026')); assert.ok(html.includes('50.000 VND'));
  props={...props,trend:[{period:'2026-10-23',totalRevenue:0,bookingRevenue:0,serviceRevenue:0,packageRevenue:0,membershipTransferFees:0,refunds:0}]};
  assert.equal(bars().length,0);
  assert.equal(requests,0); assert.deepEqual(data,original);
});
