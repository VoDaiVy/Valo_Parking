import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('login replaces anonymous socket credentials; reconnect refreshes persisted renewal notifications', async () => {
  const previous = {window:globalThis.window,localStorage:globalThis.localStorage};
  let token = null; const listeners = new Map();
  globalThis.localStorage = {getItem:()=>token};
  globalThis.window = {addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name),setTimeout:(fn)=>{fn();return 1;},clearTimeout(){}};
  const server = await createServer({configFile:false, cacheDir:'node_modules/.vite-renewal-socket-test',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,ws:false},plugins:[{
    name:'socket-renewal-fixture',enforce:'pre',resolveId(id){if(id.startsWith('virtual:renewal-'))return '\0'+id;},
    load(id){
      if(id==='\0virtual:renewal-hooks')return `
        let states=[],refs=[],cursor=0,refCursor=0;export let effects=[];
        export const reset=()=>{states=[];refs=[];effects=[];cursor=0;refCursor=0;};
        export const begin=()=>{cursor=0;refCursor=0;effects=[];};
        export const useState=(initial)=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];};
        export const useRef=initial=>{const i=refCursor++;return refs[i]||={current:initial};};
        export const useEffect=fn=>{effects.push(fn);};export const useCallback=fn=>fn;
      `;
      if(id==='\0virtual:renewal-socket')return `
        export const sockets=[];export const io=(_url,options)=>{const handlers=new Map();const socket={auth:options.auth,connected:true,disconnected:false,on:(event,fn)=>handlers.set(event,fn),off:(event)=>handlers.delete(event),disconnect(){this.disconnected=true;this.connected=false;},handlers};sockets.push(socket);return socket;};
        export const useSocket=()=>sockets.at(-1);
      `;
      if(id==='\0virtual:renewal-api')return `
        export const notice={_id:'inbox-fixture',notificationId:'507f1f77bcf86cd799439011',title:'Membership renewed successfully',priority:'SUCCESS',type:'SYSTEM',isRead:false,metadata:{eventType:'MEMBERSHIP_ENTITLEMENT_RENEWAL_SUCCESS',entitlementId:'507f1f77bcf86cd799439012'}};
        export let fetches=0;export const getNotifications=async()=>{fetches++;return {ok:true,data:{data:[notice],pagination:{totalPages:1}}};};export const getUnreadCount=async()=>({ok:true,data:{data:{count:1}}});
      `;
    },
    transform(source,id){
      if(id.endsWith('/contexts/SocketProvider.jsx'))return source.replace("import { createContext, useEffect, useState, useRef } from 'react';","import {createContext} from 'react'; import {useEffect,useState,useRef} from 'virtual:renewal-hooks';").replace("from 'socket.io-client'","from 'virtual:renewal-socket'");
      if(id.endsWith('/hooks/useNotifications.js'))return source.replace("from 'react'","from 'virtual:renewal-hooks'").replace("from './useSocket'","from 'virtual:renewal-socket'").replace("from '../services/notificationService'","from 'virtual:renewal-api'");
    },
  },react()]});
  let cleanProvider; let cleanups=[];
  try{
    const hooks=await server.ssrLoadModule('virtual:renewal-hooks');const sockets=await server.ssrLoadModule('virtual:renewal-socket');
    const {SocketProvider}=await server.ssrLoadModule('/src/contexts/SocketProvider.jsx');
    hooks.reset();SocketProvider({children:null});cleanProvider=hooks.effects[0]();
    assert.equal(sockets.sockets.length,1);assert.equal(sockets.sockets[0].auth.token,undefined);
    token='fixture-customer-token';listeners.get('valo_auth_change')();
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(sockets.sockets.length,2,'an existing guest connection must not survive login');
    assert.equal(sockets.sockets[0].disconnected,true);assert.equal(sockets.sockets[1].auth.token,token);
    listeners.get('valo_auth_change')();await new Promise(resolve=>setTimeout(resolve,150));assert.equal(sockets.sockets.length,2,'same token must not create extra sockets');
    const {useNotifications:runHook}=await server.ssrLoadModule('/src/hooks/useNotifications.js');const api=await server.ssrLoadModule('virtual:renewal-api');
    hooks.reset();runHook({autoFetch:false,contextRole:'customer'});cleanups=hooks.effects.map(fn=>fn());
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.ok(api.fetches>=1,'already-connected authenticated socket reconciles persisted inbox');
    sockets.sockets[1].handlers.get('connect')();await new Promise(resolve=>setTimeout(resolve,0));
    hooks.begin();const state=runHook({autoFetch:false,contextRole:'customer'});
    assert.equal(state.notifications[0].priority,'SUCCESS');assert.equal(state.notifications[0].title,'Membership renewed successfully');assert.equal(state.unreadCount,1);
  }finally{for(const cleanup of cleanups)cleanup?.();cleanProvider?.();await server.close();for(const key of ['window','localStorage']){if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];}}
});
