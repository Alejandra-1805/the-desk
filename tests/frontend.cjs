const fs=require('fs'),assert=require('assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
const h=fs.readFileSync('index.html','utf8'),d=new JSDOM(h,{runScripts:'outside-only',url:'https://example.com'}),w=d.window;
w.requestAnimationFrame=()=>0;w.HTMLElement.prototype.scrollIntoView=function(){this.scrolled=true};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
w.fetch=async()=>({ok:true,json:async()=>({launches:[],fromBlock:0,toBlock:10,nextCursor:null})});
w.eval(h.match(/<script>([\s\S]*?)<\/script>/)[1]);await new Promise(r=>setTimeout(r,0));
w.document.querySelector('.heroCTA').click();assert(w.document.querySelector('#create-token').scrolled);assert(!w.document.querySelector('#review').open);
w.document.querySelector('[data-dot="yellow"]').click();assert(w.document.querySelector('#selectedDotArt').src.includes('02_dot_amarillo_frente'));
const f=w.document.querySelector('#tokenForm');f.elements.name.value='NOVA';f.elements.symbol.value='NOVA';f.elements.description.value='<img src=x onerror=alert(1)>';
f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert(w.document.querySelector('#review').open);assert(!w.document.querySelector('#reviewContent p img'));assert(w.dotLabCurrentDraft.dot==='yellow');assert(w.document.querySelector('#signLaunch').disabled);
w.document.querySelector('[data-token-view="launched"]').click();assert.equal(w.document.querySelectorAll('.publicTokenCard').length,0);
w.dispatchEvent(new w.CustomEvent('dotlab:confirmed',{detail:{address:'0x'+'a'.repeat(40),chainId:46630,status:'confirmed',name:'TEST',symbol:'TEST',dot:'green'}}));
assert.equal(w.document.querySelector('.publicTokenCard').href,'https://explorer.testnet.chain.robinhood.com/address/0x'+'a'.repeat(40));
assert(!w.document.querySelector('model-viewer'));console.log('PASS: centered form navigation, Dot selection, escaped review, signing gate, draft separation and testnet explorer routing');
})().catch(e=>{console.error(e);process.exitCode=1});
