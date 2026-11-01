const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('app.js','utf8');
const host={innerHTML:'',scrollTop:0,scrollHeight:100,clientHeight:100,querySelectorAll:()=>[]};
const ctx={console,Date,Math,Set,Map,Object,String,Number,state:{user:{uid:'me'},userProfile:{displayName:'Я'}},friendsCache:[{uid:'alice',displayName:'Алиса'}],db:{},activeFriend:'alice',activeGroupId:null,activeConversationId:'alice_me',vvDirectDocs:[{id:'m1',senderUid:'alice',text:'Привет <script>',createdAt:3}],vvChatMentions:[{id:'s1',storyId:'s1',fromUid:'alice',fromUsername:'alice',createdAt:1,expiresAt:Date.now()+60000},{id:'s2',storyId:'s2',fromUid:'bob',fromUsername:'bob',createdAt:2,expiresAt:0}],document:{getElementById:()=>host},escapeHTML:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),roleBadgeMarkup:()=>'',alert:m=>{throw Error(m)},doc:(db,...p)=>p.join('/')};
let saved={reactions:{bob:'👍'}},lastRef;
ctx.runTransaction=async(db,fn)=>fn({get:async()=>({exists:()=>true,data:()=>saved}),update:(r,d)=>{saved=d;lastRef=r}});
vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf('        const vvReactionEmojis='),src.indexOf("        document.getElementById('messageForm')?.addEventListener")),ctx);
(async()=>{
 ctx.vvRenderDirectMessages('alice');assert(host.innerHTML.includes('@alice'));assert(!host.innerHTML.includes('@bob'));assert(host.innerHTML.includes('&lt;script&gt;'));assert(host.innerHTML.indexOf('vv-chat-mention')<host.innerHTML.indexOf('data-message-id'));
 const node={dataset:{messageScope:'conversations',messageChat:'alice_me',messageId:'m1'}};
 await ctx.vvSetMessageReaction(node,'❤️',false);assert.deepEqual(saved.reactions,{bob:'👍',me:'❤️'});
 await ctx.vvSetMessageReaction(node,'❤️',false);assert.equal(saved.reactions.me,'❤️');
 await ctx.vvSetMessageReaction(node,'😂');assert.deepEqual(saved.reactions,{bob:'👍',me:'😂'});
 await ctx.vvSetMessageReaction(node,'😂');assert.deepEqual(saved.reactions,{bob:'👍'});
 await ctx.vvSetMessageReaction(node,'invalid');assert.deepEqual(saved.reactions,{bob:'👍'});
 node.dataset.messageScope='groups';node.dataset.messageChat='g1';await ctx.vvSetMessageReaction(node,'🔥');assert.equal(lastRef,'groups/g1/messages/m1');
 ctx.activeFriend='bob';ctx.activeConversationId=null;ctx.vvDirectDocs=[];ctx.vvRenderDirectMessages('bob');assert(host.innerHTML.includes('История уже недоступна'));assert(!host.innerHTML.includes('data-chat-story'));assert(host.innerHTML.includes('Добавьте автора в друзья'));
 // Exercise both gesture handlers and exclude a scrolling gesture.
 const events={};node.addEventListener=(n,f)=>events[n]=f;node.querySelector=()=>null;node.querySelectorAll=()=>[];
 const eventHost={querySelectorAll:s=>s==='[data-message-id]'?[node]:[]};ctx.vvBindMessageActions(eventHost);
 const calls=[];ctx.vvSetMessageReaction=(n,e,t)=>calls.push([e,t]);
 const ev=(x,y)=>({pointerType:'touch',clientX:x,clientY:y,target:{closest:()=>null},preventDefault(){}});
 events.pointerdown(ev(0,0));events.pointerup(ev(100,0));events.pointerdown(ev(0,0));events.pointerup(ev(0,0));assert.equal(calls.length,0);
 events.pointerdown(ev(0,0));events.pointerup(ev(0,0));assert.deepEqual(calls,[['❤️',false]]);events.dblclick(ev(0,0));assert.equal(calls.length,1);
 console.log('PASS: sender-specific chronological notices, expired notice, text escaping, persistent reactions, other user preservation, group path, double tap and scroll exclusion');
})().catch(e=>{console.error(e);process.exitCode=1});
