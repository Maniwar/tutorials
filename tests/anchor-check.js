/* ═══════════════════════════════════════════════════════════════════════════
   IS THIS CHECK READING THE PROPERTY, OR THE PACKAGING?

   The second root cause behind the recurring defects in this directory, and
   until now the one with no machinery behind it. Root cause 1 — the fixture
   cannot reach the branch — got vacuity-check.js. This one kept being caught by
   reading, by screenshot, and by luck, which is to say it kept not being
   caught. Nine-plus instances, every one of them in the CHECK rather than in
   the product:

     · cross-surface found the delta with .find(font-weight:700) and got the
       value pair instead — first thing matching a SHAPE, not the thing wanted.
     · a health-finding check matched /unbilled/i against the AREA label, so it
       passed a rename that removed the finding entirely.
     · an outstanding-total check asserted the row EXISTED rather than what it
       said.
     · a legend check asserted the key existed rather than that it was VISIBLE.
     · a bank check used innerText, which returns '' for anything not being
       rendered, and reported the shipped build for a defect that did not exist.
     · the leveling-toolbar check read the `hidden` ATTRIBUTE, agreed with the
       code, and passed on a build where the buttons were visible on all four
       sections — the stylesheet overruled the attribute and only a screenshot
       found it.

   One shape: THE ASSERTION IS ON AN ARTEFACT THAT USUALLY ACCOMPANIES THE
   PROPERTY. Position, a style value, an attribute flag, a label's words, the
   existence of a row. Each correlates with the truth until the day it does not,
   and on that day the check stays green and is counted as coverage.

   ── THE MECHANICAL QUESTION ────────────────────────────────────────────────

   The mutation engine changes what the panels SAY and requires a check to go
   red. This is the other half: change HOW they say it, leave what they say
   exactly alone, and require every check to stay GREEN. A check that goes red
   under a meaning-preserving change was reading the packaging, and it says so
   by failing — no keyword, no convention, nothing a person can satisfy by
   typing the right sentence.

   Every mutation below is invisible to a human looking at the page. That is the
   whole contract, and it is why a red result is a finding about the CHECK and
   never about the product:

     1. an extra class on every element. No CSS rule matches it, so nothing
        moves. Breaks className === '…' and classList[0].
     2. a hidden, empty, bold decoy span inside every table cell. Adds no text,
        no layout, no visible mark — and breaks "find the bold one", which is
        how a check once grabbed a value pair and called it a delta.
     3. a space either side of the text in leaf elements. HTML collapses it, so
        the rendering is identical; textContent gains two characters. Breaks
        exact equality on untrimmed text.

   ── WHAT THIS DOES NOT CATCH, said plainly so nobody reads more into a green
   run than is in it ────────────────────────────────────────────────────────

   It cannot catch an assertion anchored to a LABEL's words, because renaming a
   heading is not meaning-preserving and resolving a column by its header is the
   CORRECT pattern — a probe that renamed headings would punish the right
   answer. It cannot catch "asserted the row exists rather than what it says",
   because existence survives every mutation here by design. And it cannot catch
   an attribute read that disagrees with the computed style, because swapping
   `hidden` for `display:none` is not meaning-preserving in general — that is
   the case the author of this file got wrong twice and it stays outside.

   So this covers the positional and stylistic third of the pattern. The
   mutation engine covers "you would have noticed a wrong value", vacuity-check
   covers "you looked at the input", and this covers "you looked at the thing
   itself rather than at what it happened to be wearing". Three probes, three
   different questions, and none of them is the whole standard.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP = path.resolve(ROOT, 'pert-gantt-tracker.html');
const ONLY = process.argv.slice(2).filter(a => !a.startsWith('-'));

/* Injected at the END of the body so it runs after the app's own script has
   defined everything, and re-applied on every DOM mutation because these panels
   are redrawn constantly — decorating once would leave the probe describing a
   page that no longer exists by the time a check looks at it. */
const DECORATOR = `
<script>
(function () {
  var SKIP = { SCRIPT: 1, STYLE: 1, PRE: 1, CODE: 1, TEXTAREA: 1, OPTION: 1, TITLE: 1, svg: 1 };
  var busy = false;
  function decorate(el) {
    if (!el || el.nodeType !== 1 || el.__pz) return;
    /* SVG className is an SVGAnimatedString, not a string — classList.add on it
       throws in some engines and the drawn charts are full of them. Nothing
       here is about SVG, so it is skipped entirely rather than special-cased. */
    if (el.ownerSVGElement || el.tagName === 'svg') return;
    if (SKIP[el.tagName]) return;
    el.__pz = 1;
    try { el.classList.add('pz'); } catch (e) {}
    /* PADDING BEFORE THE DECOY, and the order is not cosmetic. Appending the
       decoy makes a table cell non-empty of children, so the leaf test below it
       stopped being true for exactly the cells the padding was aimed at and
       nothing was padded at all — 93 leaf cells, 0 padded. The probe's own two
       mutations cancelled, and a probe that quietly applies one of the three
       things it claims is the same green-for-the-wrong-reason it exists to
       catch. Found by counting rather than by reading the code, which is the
       only reason it was found. */
    // 3. a space either side of the text, which HTML collapses to nothing
    if (!el.children.length && el.firstChild && el.firstChild.nodeType === 3) {
      var v = el.firstChild.nodeValue;
      if (v && v.trim() && v === v.trim()) el.firstChild.nodeValue = ' ' + v + ' ';
    }
    // 2. a bold decoy that no human can see, inside every table cell
    if (el.tagName === 'TD' || el.tagName === 'TH') {
      try {
        var d = document.createElement('span');
        d.className = 'pz-decoy';
        d.setAttribute('aria-hidden', 'true');
        d.setAttribute('style', 'display:none;font-weight:700');
        d.__pz = 1;
        el.appendChild(d);
      } catch (e) {}
    }
  }
  function sweep(root) {
    if (!root) return;
    decorate(root);
    var all;
    try { all = root.querySelectorAll ? root.querySelectorAll('*') : []; } catch (e) { return; }
    for (var i = 0; i < all.length; i++) decorate(all[i]);
  }
  /* The observer mutates the DOM, so without the guard it would observe its own
     work and recurse until the stack gives out. Disconnected around the pass
     rather than filtered afterwards: filtering would still queue thousands of
     records per render on a plan this size. */
  var obs = new MutationObserver(function () {
    if (busy) return;
    busy = true;
    try { obs.disconnect(); sweep(document.body); } catch (e) {}
    try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    busy = false;
  });
  function start() {
    sweep(document.body);
    try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    window.__pzActive = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
</script>
`;

/* Every check that drives the product. run-test-plan is included because it is
   forty-five assertions about drawn panels and is exactly as capable of reading
   a class name as any sweep. */
const CHECKS = fs.readdirSync(__dirname)
  .filter(f => /sweep.*\.js$/.test(f) || f === 'golden-reference.js' || f === 'run-test-plan.js')
  .filter(f => !ONLY.length || ONLY.some(o => f.indexOf(o) >= 0))
  .sort();

function run(script, appFile) {
  return new Promise(resolve => {
    const env = Object.assign({}, process.env, { APP_FILE: appFile });
    const ch = spawn(process.execPath, [path.join(__dirname, script)], { cwd: ROOT, env: env, stdio: 'pipe' });
    let out = '';
    ch.stdout.on('data', d => out += d);
    ch.stderr.on('data', d => out += d);
    const t = setTimeout(() => { try { ch.kill('SIGKILL'); } catch (e) {} }, 240000);
    ch.on('close', code => { clearTimeout(t); resolve({ code: code, out: out }); });
  });
}

/* The first line that reads like an assertion failing, for the report. A
   finding that says only "this sweep went red" sends the reader back to run it
   themselves, which is most of the work. */
function firstFinding(out) {
  const m = out.match(/"[^"]*::[^"]{10,}/);
  if (m) return m[0].replace(/^"/, '').slice(0, 220);
  const e = out.match(/(?:Error|TypeError|ReferenceError)[^\n]{0,160}/);
  return e ? e[0] : '(no assertion text captured)';
}

(async () => {
  if (!fs.existsSync(APP)) { console.error('product file not found: ' + APP); process.exit(2); }
  const src = fs.readFileSync(APP, 'utf8');
  const at = src.lastIndexOf('</body>');
  if (at < 0) { console.error('no </body> in the product file — nothing to inject into'); process.exit(2); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-anchor-'));
  const mutant = path.join(tmp, 'presentation-mutant.html');
  fs.writeFileSync(mutant, src.slice(0, at) + DECORATOR + src.slice(at));

  const findings = [], rows = [], notes = [];
  for (const c of CHECKS) {
    /* The BASELINE matters. A check that is red on the shipped build is red
       under the probe too, and calling that an anchoring finding would be the
       same mistake vacuity-check's first version made — reporting a check for
       a condition that has nothing to do with the question being asked. */
    const base = await run(c, APP);
    if (base.code !== 0) {
      notes.push(c + ' is already red on the shipped build, so this probe can say nothing about it');
      rows.push({ check: c, baseline: base.code, underProbe: null, verdict: 'skipped-already-red' });
      continue;
    }
    const probed = await run(c, mutant);
    rows.push({ check: c, baseline: 0, underProbe: probed.code,
                verdict: probed.code === 0 ? 'reads the property' : 'ANCHORED' });
    if (probed.code !== 0)
      findings.push(c + ' :: goes RED when the page is restyled without changing a single thing it says. '
        + 'Nothing a reader can see is different, so this is an assertion on the packaging rather than on '
        + 'the property — first failure: ' + firstFinding(probed.out));
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(JSON.stringify({ checks: rows.length, rows: rows, notes: notes, findings: findings }, null, 1));
  if (findings.length) {
    console.log('\n' + findings.length + ' check(s) are anchored to how the page LOOKS rather than to what it '
      + 'says. Every mutation applied is invisible to a human — an unused class, a hidden empty span, a space '
      + 'either side of some text — so a red run here is a defect in the check, never in the product.');
  } else {
    console.log('\nall ' + rows.length + ' checks survived a restyling that changed nothing they assert about'
      + (notes.length ? '; ' + notes.length + ' not covered and named above' : '') + '.');
  }
  process.exitCode = findings.length ? 1 : 0;
})();
