/* ═══════════════════════════════════════════════════════════════════════════
   DOES THE SWEEP ACTUALLY CATCH ANYTHING?

   A green run against a healthy application proves nothing. Every probe in this
   directory has, at some point, been green because it was asking a question
   that could not fail — a count compared against itself, a check against a
   fixture that never contained the condition. That is the single reason defects
   reached the user instead of the suite.

   So this file breaks the drawing on purpose, one defect at a time, and asserts
   drawn-surfaces-sweep.js names each one. It lifts the sweep's own body out of
   that file and injects the mutation between render and read, so it is testing
   the shipped check, not a copy of it that could drift.

   A surviving mutant is a hole in the sweep. Run it whenever the sweep changes.
   ═══════════════════════════════════════════════════════════════════════════ */
const { requirePlaywright, chromePath, APP } = require('./_harness');
const fs=require('fs');
const CRM=JSON.parse(fs.readFileSync(require('path').resolve(__dirname,'..','fixtures','crm-rollout.json'),'utf8'));

const HELP = `const leafBar = (pred) => [...document.querySelectorAll('[data-gopen]')].find(e=>{
  const t=tasks.find(x=>x.id===+e.dataset.gopen);
  return t && !t.isSummary && !t.milestone && e.querySelector('rect') && (!pred||pred(t)); });`;

const MUTANTS = {
  'gantt bar drawn at the wrong x':
    `const r=leafBar().querySelector('rect'); r.setAttribute('x', String(+r.getAttribute('x')+400));`,
  'gantt bar drawn at the wrong width':
    `const r=leafBar().querySelector('rect'); r.setAttribute('width', String(+r.getAttribute('width')*3+9));`,
  'gantt tooltip quotes a foreign date':
    `leafBar().querySelector('title').textContent='1 Jan 2001 → 2 Jan 2001  •  0% done  •  slack 99.9 d';`,
  'a critical bar painted in the float colour':
    `leafBar(t=>t.isCritical&&(t.percentComplete||0)<100).querySelector('rect').setAttribute('fill','#93c5fd');`,
  'a bar with float painted as critical':
    `[...leafBar(t=>!t.isCritical&&(t.percentComplete||0)<100).querySelectorAll('rect')].forEach(r=>r.setAttribute('fill','#dc2626'));`,
  'an activity vanishes from the network':
    `const n=document.querySelector('#pertSvg [data-popen]'); n.parentNode.removeChild(n);`,
  'a PERT node prints the wrong slack':
    `document.querySelector('[data-popen] text').textContent='slack 42.0 d';`,
  'the PERT caption miscounts the plan':
    `document.getElementById('pertAggNote').textContent='Showing 3 node(s) from 999 scheduled activities';`,
  'a grid row styled critical with float':
    `[...document.querySelectorAll('#taskTable tbody tr[data-task-id]')].find(r=>{const t=tasks.find(x=>x.id===+r.dataset.taskId);return t&&Math.abs(t.slack||0)>1}).classList.add('critical');`,
  'a leaked undefined on screen':
    `document.querySelector('#view-analytics .card-body').insertAdjacentHTML('afterbegin','<p>Margin: undefined%</p>');`
};

const SRC = fs.readFileSync(require('path').resolve(__dirname,'drawn-surfaces-sweep.js'),'utf8');
const HEAD = 'return page.evaluate(lbl => {';
const body = SRC.slice(SRC.indexOf(HEAD)+HEAD.length, SRC.lastIndexOf('}, label);'));

(async()=>{
const {chromium}=requirePlaywright();
const b=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:chromePath()});
const page=await b.newPage({viewport:{width:1440,height:1200}});
page.on('dialog',d=>d.accept());
await page.goto(APP,{waitUntil:'load'});
let missed = 0;
for (const [name, mut] of Object.entries(MUTANTS)) {
  const fn = `(lbl) => { const __mut = () => { try{${HELP}\n${mut}}catch(e){return 'MUTANT FAILED: '+e.message} }; ${body} }`;
  const patched = fn
    .replace("switchTab('gantt'); renderGantt();",
             "switchTab('gantt'); renderGantt(); { const m=__mut(); if(m) bad.push(m); }")
    .replace("try { renderPERT(); }",
             "try { renderPERT(); const m=__mut(); if(m) bad.push(m); }")
    .replace("switchTab('tasks'); renderTaskTable();",
             "switchTab('tasks'); renderTaskTable(); { const m=__mut(); if(m) bad.push(m); }")
    .replace("switchTab(tab);\n          const host",
             "switchTab(tab); if(tab==='analytics'){const m=__mut(); if(m) bad.push(m);}\n          const host");
  const r = await page.evaluate(async ([d,src])=>{ hydrate(d); calculate();
    await new Promise(z=>setTimeout(z,400));
    return (0,eval)('('+src+')')('mutant'); }, [CRM, patched]);
  const hit = r.contradictions.filter(c=>!/MUTANT FAILED/.test(c));
  if (!hit.length) missed++;
  console.log((hit.length?'CAUGHT  ':'MISSED  ')+name.padEnd(44)
    +(hit.length?'→ '+hit[0].replace('mutant · ','').slice(0,96):r.contradictions.join('|')));
}
console.log(missed?('\n'+missed+' mutant(s) survived'):'\nevery planted defect was caught');
await b.close(); if (missed) process.exitCode=1;
})();
