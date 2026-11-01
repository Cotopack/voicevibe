const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app.js','utf8');const handlers={};let focused=0;
const parent={clientWidth:400,clientHeight:700,clientLeft:0,clientTop:0,scrollLeft:0,scrollTop:0,getBoundingClientRect:()=>({left:0,top:0})};
const text={offsetParent:parent,offsetWidth:100,offsetHeight:40,style:{},classList:{add(){},remove(){}},getBoundingClientRect:()=>({left:150,top:300,width:100,height:40}),setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){},blur(){},focus(){focused++},addEventListener:(n,fn)=>handlers[n]=fn};
const size={value:'28'};const ctx={document:{getElementById:()=>size},applyTextSettings(){},vvCanvasText:text,window:{getSelection:()=>({removeAllRanges(){}})},vvStoryPanel(){},Math};vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('        let vvSuppressTextClick=false,'),source.indexOf("        document.getElementById('storyCreateToggle')",source.indexOf('        let vvSuppressTextClick=false,'))),ctx);
const e=(x,y,type='pointermove')=>({clientX:x,clientY:y,button:0,pointerId:1,type,preventDefault(){}});
handlers.pointerdown(e(160,310));handlers.pointermove(e(180,340));assert.equal(text.style.left,'170px');assert.equal(text.style.top,'330px');assert.equal(text.style.transform,'none');handlers.pointermove(e(1000,1000));assert.equal(text.style.left,'300px');assert.equal(text.style.top,'660px');handlers.pointerup(e(1000,1000,'pointerup'));assert.equal(focused,0);
handlers.pointerdown(e(160,310));handlers.pointerup(e(160,310,'pointerup'));assert.equal(focused,1);console.log('PASS: direct text drag, retained pointer offset, canvas bounds, tap to edit');

handlers.pointerdown(e(150,300));handlers.pointerdown({...e(250,300),pointerId:2});handlers.pointermove({...e(350,300),pointerId:2});assert.equal(Number(size.value),56);handlers.pointermove({...e(200,300),pointerId:2});assert.equal(Number(size.value),16);handlers.pointercancel({...e(200,300,'pointercancel'),pointerId:2});handlers.pointerup(e(150,300,'pointerup'));console.log('PASS: two-finger enlargement and reduction, minimum size, cancel cleanup');
