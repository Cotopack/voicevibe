const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('./app.js','utf8'),html=fs.readFileSync('./index.html','utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
const missing=[...src.matchAll(/getElementById\('([^']+)'\)/g)].map(m=>m[1]).filter(id=>!ids.has(id));
console.log('IDs absent from static HTML (includes dynamic elements):', [...new Set(missing)]);
let callbacks=[],timers=[],cleared=[];const elements=new Map();
function element(id){if(elements.has(id))return elements.get(id);const noop=()=>{};const e={id,value:'',textContent:'',innerHTML:'',dataset:{},style:{setProperty:noop},classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},getContext:()=>({}),addEventListener:noop,removeEventListener:noop,querySelectorAll:()=>[],querySelector:()=>null,appendChild:noop,append:noop,replaceChildren:noop,setAttribute:noop,getAttribute:()=>'',removeAttribute:noop,getBoundingClientRect:()=>({height:80}),pause:noop,play:()=>Promise.resolve()};elements.set(id,e);return e;}
const context={fetch:async()=>({ok:true,json:async()=>({ok:true,tracks:[]})}),console,URL,URLSearchParams,Date,Map,Set,Math,Number,String,Promise,Array,JSON,Error,Uint8Array,Float32Array,DataView,ArrayBuffer,Blob,location:{search:'',origin:'https://test.local',pathname:'/'},localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},navigator:{},document:{getElementById:id=>ids.has(id)?element(id):null,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>element('dynamic'),addEventListener:()=>{},removeEventListener:()=>{},documentElement:element('html'),body:element('body')},setTimeout:f=>{timers.push(f);return timers.length},clearTimeout:()=>{},setInterval:()=>17,clearInterval:x=>cleared.push(x),MutationObserver:class{observe(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},alert:()=>{},confirm:()=>false};context.window=context;context.addEventListener=()=>{};
for(const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g))for(const n of m[1].split(',').map(x=>x.trim()).filter(Boolean))context[n]=()=>({});
context.setPersistence=()=>Promise.resolve();context.getRedirectResult=()=>Promise.resolve();context.onAuthStateChanged=(a,f)=>{callbacks.push(f);return ()=>{}};
vm.createContext(context);
(async()=>{const clean=src.replace(/import\s*\{[^}]+\}\s*from\s*"[^"]+";/g,'');
await vm.runInContext(`(async()=>{${clean}\n globalThis.__test={state,vvCallEnd,vvCallBind,closeConversation,setRing:()=>{vvRingTimer=17;},getActiveGroup:()=>activeGroupId,setGroup:()=>activeGroupId='test'};})()`,context);
for(const cb of callbacks)await cb(null);
const t=context.__test;t.setRing();t.vvCallEnd();assert(cleared.includes(17));t.setGroup();t.closeConversation();assert.equal(t.getActiveGroup(),null);
assert(src.includes('limitToLast(100)'));assert(src.includes('limitToLast(200)'));assert(src.includes("const storyRef = await addDoc(collection(db,'stories')"));
for(const f of ['app.js','index.html','styles.css','firestore.rules'])assert(fs.readFileSync('./'+f).equals(fs.readFileSync('./public/'+f)));
console.log('PASS: module startup, sign-out callbacks, ringtone cleanup, group close, latest-message queries, mention reference, synchronized deploy files');
})().catch(e=>{console.error(e);process.exitCode=1});
