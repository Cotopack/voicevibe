const fs=require('fs'),assert=require('assert');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 await page.setContent('<div id="messagesList"></div>');
 await page.addStyleTag({content:fs.readFileSync('styles.css','utf8')});
 await page.evaluate(()=>{
  window.state={user:{uid:'me'},userProfile:{displayName:'Я'}};window.friendsCache=[{uid:'alice',displayName:'Алиса'}];window.db={};
  window.activeFriend='alice';window.activeGroupId=null;window.activeConversationId='alice_me';
  window.vvChatMentions=[{id:'s1',storyId:'s1',fromUid:'alice',fromUsername:'alice',createdAt:1,expiresAt:Date.now()+10000},{id:'s2',storyId:'s2',fromUid:'bob',fromUsername:'bob',createdAt:2,expiresAt:0}];
  window.vvDirectDocs=[{id:'m1',senderUid:'alice',text:'Привет <script>',createdAt:3,reactions:{bob:'👍'}}];
  window.escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));window.roleBadgeMarkup=()=>'';
  window.startSnake=()=>{};window.vvOpenMentionStory=id=>window.openedStory=id;window.vvRepostMention=id=>window.repostedStory=id;
  window.doc=(db,...p)=>p.join('/');window.saved={reactions:{bob:'👍'}};window.runTransaction=async(db,fn)=>fn({get:async()=>({exists:()=>true,data:()=>window.saved}),update:(r,d)=>{window.saved=d;window.lastRef=r;}});
 });
 const src=fs.readFileSync('app.js','utf8');
 await page.addScriptTag({content:src.slice(src.indexOf('        const vvReactionEmojis='),src.indexOf("        document.getElementById('messageForm')?.addEventListener"))});
 await page.evaluate(()=>vvRenderDirectMessages('alice'));
 assert.equal(await page.locator('.vv-chat-mention').count(),1);
 assert(!(await page.locator('#messagesList').innerText()).includes('@bob'));
 assert((await page.locator('.vv-message-bubble').innerText()).includes('Привет <script>'));
 await page.locator('[data-chat-story]').click();assert.equal(await page.evaluate(()=>openedStory),'s1');
 await page.locator('.vv-message-author').dblclick();assert.deepEqual(await page.evaluate(()=>saved.reactions),{bob:'👍',me:'❤️'});
 await page.locator('.vv-reaction-open').click();await page.locator('.vv-reaction-picker [data-reaction="😂"]').click();assert.deepEqual(await page.evaluate(()=>saved.reactions),{bob:'👍',me:'😂'});
 await page.locator('.vv-reaction-open').click();await page.locator('.vv-reaction-picker [data-reaction="😂"]').click();assert.deepEqual(await page.evaluate(()=>saved.reactions),{bob:'👍'});
 // Two touch taps add a heart; the synthesized dblclick must not toggle it off.
 await page.evaluate(async()=>{
  const n=document.querySelector('[data-message-id]');await new Promise(r=>setTimeout(r,650));
  for(let i=0;i<2;i++){n.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',clientX:25,clientY:25,bubbles:true}));n.dispatchEvent(new PointerEvent('pointerup',{pointerType:'touch',clientX:25,clientY:25,bubbles:true}));}
 });
 assert.equal(await page.evaluate(()=>saved.reactions.me),'❤️');
 await page.evaluate(()=>{activeFriend='bob';activeConversationId=null;vvDirectDocs=[];vvRenderDirectMessages('bob')});
 assert((await page.locator('#messagesList').innerText()).includes('История уже недоступна'));assert.equal(await page.locator('[data-chat-story]').count(),0);
 assert.equal(await page.locator('.vv-mention-hint').count(),1);
 await page.evaluate(()=>{document.getElementById('messagesList').innerHTML=vvRenderChatMessage({id:'g1',senderUid:'alice',text:'Группа',createdAt:2},'groups','group1');vvBindMessageActions(document.getElementById('messagesList'));});
 await page.locator('.vv-message-author').dblclick();assert.equal(await page.evaluate(()=>lastRef),'groups/group1/messages/g1');
 await browser.close();console.log('PASS: chat mention isolation, expired story, escaped text, mouse/touch hearts, emoji replacement/removal, other user preserved, group reaction path');
})().catch(e=>{console.error(e);process.exitCode=1});
