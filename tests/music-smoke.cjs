const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let calls=0;
const context={Response,Request,URL,TextEncoder,Uint8Array,Date,JSON,Math,Number,String,Error,Promise,Set,btoa,atob,fetch:async(url,options)=>{
 assert.match(String(url),/api\.cloudinary\.com\/v1_1\/demo\/resources\/search$/);
 assert.equal(options.headers.Authorization,'Basic '+btoa('key:secret'));
 const body=JSON.parse(options.body);calls++;
 const track={asset_id:'one',public_id:'music/first_song',format:'mp3',secure_url:'https://res.cloudinary.com/demo/video/upload/first.mp3',duration:80};
 if(calls===1)return Response.json({resources:[track,{asset_id:'video',format:'mp4',secure_url:'https://example.com/video.mp4'}],next_cursor:'page-2'});
 assert.equal(body.next_cursor,'page-2');return Response.json({resources:[track,{asset_id:'two',display_name:'Second.wav',format:'wav',secure_url:'https://example.com/second.wav',context:{custom:{artist:'Artist'}}}]});
}};
vm.createContext(context);vm.runInContext(fs.readFileSync('worker.js','utf8').replace('export default {','globalThis.worker = {'),context);
(async()=>{const r=await context.worker.fetch(new Request('https://worker.local/api/music',{headers:{Origin:'https://cotopack.github.io'}}),{CLOUDINARY_CLOUD_NAME:'demo',CLOUDINARY_API_KEY:'key',CLOUDINARY_API_SECRET:'secret'});assert.equal(r.status,200);const d=await r.json();assert.equal(calls,2);assert.equal(d.total,2);assert.equal(d.tracks[0].title,'first song');assert.equal(d.tracks[1].title,'Second');assert.equal(d.tracks[1].artist,'Artist');console.log('PASS: Cloudinary settings, pagination, audio filtering, deduplication and metadata');})().catch(e=>{console.error(e);process.exitCode=1});
