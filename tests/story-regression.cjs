const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app.js','utf8');
const noop=()=>{};
function element(){let value='';return {get innerText(){return value},set innerText(v){value=v},get textContent(){return value},set textContent(v){value=v},value:'',style:{removeProperty:noop},classList:{add:noop,remove:noop},blur:noop,setAttribute:noop};}
const text=element(),layers=[],status=element();
const ctx={vvCanvasText:text,vvTextLayers:layers,vvEditingLayer:-1,vvMentionSeq:0,storyStatus:status,storyTextInput:element(),vvMentionResults:element(),vvLayerSnapshot:n=>({text:n.innerText}),vvRenderLayers:noop,vvStoryPanel:noop};vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('        function vvCommitCurrentText(){'),source.indexOf('        function vvAllStoryText()')),ctx);
text.innerText='Первый';assert.equal(ctx.vvCommitCurrentText(),true);text.innerText='Второй';ctx.vvCommitCurrentText();assert.deepEqual(layers.map(l=>l.text),['Первый','Второй']);
while(layers.length<10)layers.push({text:'test'});text.innerText='Не терять';assert.equal(ctx.vvCommitCurrentText(),false);assert.equal(text.innerText,'Не терять');assert.equal(layers.length,10);
layers.splice(3,1);ctx.vvEditingLayer=3;text.innerText='Изменённый';assert.equal(ctx.vvCommitCurrentText(),true);assert.equal(layers[3].text,'Изменённый');assert.equal(layers.length,10);
const handlers={};ctx.storyGalleryInput={addEventListener:(name,fn)=>handlers[name]=fn,files:[]};ctx.vvResetStoryDraftText=()=>{throw Error('Draft cleared on cancellation')};
vm.runInContext(source.slice(source.indexOf("        storyGalleryInput?.addEventListener('click'"),source.indexOf("        document.getElementById('storyMusicPreviewPlay')")),ctx);handlers.click();handlers.change();
Object.assign(ctx,{vvMusicApplied:true,vvSelectedTrack:{url:'old'},vvPreviewTimer:1,clearInterval:noop,vvMusicPlayer:{pause:noop,onloadedmetadata:noop},setMusicPreviewFile:noop,vvEditor:element(),document:{getElementById:()=>element()},vvMusicSelected:element(),vvMusicClear:element(),musicStartInput:{value:'8'},musicLengthInput:{value:'3'},vvMusicFade:{checked:true},vvRenderCatalog:noop,updateMusicTrimLabel:noop});
vm.runInContext(source.slice(source.indexOf('        function vvResetStoryMusic(){'),source.indexOf('        function vvResetStoryDraftText(){')),ctx);ctx.vvResetStoryMusic();assert.equal(ctx.vvSelectedTrack,null);assert.equal(ctx.vvMusicApplied,false);assert.equal(ctx.musicStartInput.value,'0');assert.equal(ctx.vvMusicPlayer.onloadedmetadata,null);
console.log('PASS: multiple texts, lossless limit, editing at limit, cancelled gallery, music reset');
