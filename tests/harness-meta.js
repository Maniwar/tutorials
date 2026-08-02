/* ═══════════════════════════════════════════════════════════════════════════
   THE CHECKS, CHECKED.

   Every other file in this directory asks whether the PRODUCT is right. This
   one asks whether the checks can still say no — because twice now the answer
   has been no, and both times it was invisible from the outside.

   THE FIRST WAY A CHECK DIES: no exit code. Seven of the seventeen sweeps once
   printed their contradictions to stdout and exited 0. The commit gate and the
   mutation harness both judge by exit status, so every one of those findings
   arrived as a tick. It surfaced only because two deliberate defects were
   planted, reported BY NAME in the sweep's own output, and still counted as
   SURVIVED. A check that cannot fail is worse than no check, because it is
   counted.

   THE SECOND WAY: a reporting branch that throws. In cross-surface-sweep,
   eleven calls read `money(...)` where the global is `fmtMoney(...)` — money()
   is local to planTruthData() and does not exist in page scope. Every one of
   those calls sat INSIDE the branch that reports a finding. So the sweep threw
   at the exact moment it had something to say, and never once on a healthy
   build: green all the way through development, and guaranteed to die the first
   time it was right. Combined with the missing exit code, that produced a stack
   trace and a passing gate.

   The second is the interesting one, and it is why this file loads the app in a
   browser rather than just reading source. Whether `money` exists is not a
   question about the check — it is a question about the page the check runs
   inside. So: extract every call made in a page.evaluate body, subtract what is
   declared there and what the language provides, and require the rest to be
   real functions on the loaded application. A branch nobody has taken is
   checked exactly as strictly as one taken every run, which is the whole point:
   frequency is what hid the defect, and a static reading does not care.

   It also self-tests. A linter that has gone blind reports a clean directory,
   which is indistinguishable from a clean directory — so at the end it plants
   both defects into synthetic files and requires itself to name them.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const { requirePlaywright, chromePath, APP } = require('./_harness');
const { chromium } = requirePlaywright();
const fs = require('fs'), path = require('path'), os = require('os');

const DIR = __dirname;
const SELF = path.basename(__filename);
/* _harness is a library, not a check: it exports and exits nothing. Everything
   else directly in tests/ IS a check and is held to both properties. Probes live
   in tests/probes and are deliberately out of scope — they observe and never
   fail, which is stated in their own README and is the reason they were moved
   out of here. */
const NOT_A_CHECK = new Set(['_harness.js', SELF]);

/* Names the language and the two runtimes provide. A call to one of these tells
   us nothing, so they are subtracted before anything is asked of the app. Kept
   deliberately broad: over-listing here costs a missed finding, under-listing
   costs a false one, and a false one trains people to ignore this file. */
const PROVIDED = new Set([
  // language
  'Array', 'Boolean', 'Date', 'Error', 'TypeError', 'RangeError', 'Function', 'JSON', 'Map', 'Math',
  'Number', 'Object', 'Promise', 'Proxy', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'WeakMap',
  'WeakSet', 'BigInt', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'structuredClone', 'queueMicrotask', 'eval',
  // browser
  'fetch', 'alert', 'confirm', 'prompt', 'getComputedStyle', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'atob', 'btoa',
  'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response', 'URL', 'URLSearchParams',
  'Image', 'Option', 'Event', 'CustomEvent', 'ErrorEvent', 'MouseEvent', 'KeyboardEvent', 'PointerEvent',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'DOMParser', 'XMLSerializer',
  'XMLHttpRequest', 'TextEncoder', 'TextDecoder', 'AbortController', 'IDBKeyRange',
  // node side of a check file
  'require', 'process', 'Buffer', '__dirname', '__filename',
  // control-flow keywords that a naive "identifier followed by (" would collect
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'do', 'else', 'await', 'async',
  'new', 'delete', 'void', 'in', 'of', 'yield', 'case', 'throw', 'instanceof', 'with', 'try', 'finally',
]);

/* ── blanking ───────────────────────────────────────────────────────────────
   No parser is available offline, so this walks the text and blanks the CONTENT
   of every comment, string, template literal and regex literal, keeping the
   delimiters and every character position. Everything downstream then reads
   live code only, and offsets still line up.

   REGEX LITERALS MATTER TWICE OVER, and the first version of this file forgot
   them both times. A pattern like /(\d+)\s+activit(?:y|ies)/ contains the text
   `activit(`, which a naive identifier scan collects as a call to a function
   named `activit` — six false findings across four sweeps on the first run, and
   a check that produces false findings is a check people learn to ignore. Worse,
   a pattern containing an unbalanced paren would break the paren counting that
   locates an evaluate body, silently truncating what gets scanned. Same lesson
   as the switchTab source scan, which read the comment quoting the defect it
   documents: text that LOOKS like code is not code. */
function codeOnly(src) {
  const buf = src.split('');
  let i = 0; const n = src.length;
  const blank = (a, b2) => { for (let k = a; k < b2 && k < n; k++) if (buf[k] !== '\n') buf[k] = ' '; };
  const skipToEnd = (j, closer) => {
    j++;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === closer) return j + 1;
      j++;
    }
    return n;
  };
  /* division or regex? The standard heuristic: a `/` opens a regex when the
     previous meaningful character cannot end an expression. */
  const opensRegex = j => {
    let k = j - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    if (k < 0) return true;
    const c = src[k];
    if ('(,=:[!&|?{};+-*%~^<>'.indexOf(c) >= 0) return true;
    const word = (src.slice(Math.max(0, k - 10), k + 1).match(/([A-Za-z_$][\w$]*)$/) || [])[1];
    return ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof', 'do', 'else', 'yield']
      .indexOf(word) >= 0;
  };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const stop = e < 0 ? n : e; blank(i, stop); i = stop; continue; }
    if (c === '/' && src[i + 1] === '*') { let e = src.indexOf('*/', i); e = e < 0 ? n : e + 2; blank(i, e); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') { const e = skipToEnd(i, c); blank(i + 1, e - 1); i = e; continue; }
    if (c === '/' && opensRegex(i)) {
      // walk to the closing slash, honouring escapes and character classes
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        j++;
      }
      if (j < n && src[j] === '/') { blank(i + 1, j); i = j + 1; continue; }
    }
    i++;
  }
  return buf.join('');
}

/* Locate each page.evaluate body. Runs on ALREADY-BLANKED text, so a paren
   inside a string, a comment or a pattern cannot throw the counting off. */
function scan(code) {
  const out = [];
  const n = code.length;
  let i = 0;
  while (i < n) {
    if (code.startsWith('evaluate(', i) || code.startsWith('evaluateHandle(', i)) {
      const j = code.indexOf('(', i);
      let depth = 0, k = j;
      while (k < n) {
        if (code[k] === '(') depth++;
        else if (code[k] === ')') { depth--; if (!depth) { k++; break; } }
        k++;
      }
      out.push({ start: j + 1, end: k - 1 });
      i = k; continue;
    }
    i++;
  }
  return out;
}

// every name bound inside this text: declarations, parameters, catch bindings
function declaredNames(code) {
  const names = new Set();
  const add = s => String(s || '').split(/[,{}\[\]:\s]+/).forEach(x => {
    const m = String(x).match(/^([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
  });
  let m;
  const decl = /\b(?:const|let|var)\s+([^=;\n]+?)\s*(?:=|;|\bof\b|\bin\b)/g;
  while ((m = decl.exec(code))) add(m[1]);
  const fn = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g;
  while ((m = fn.exec(code))) { if (m[1]) names.add(m[1]); add(m[2]); }
  const arrowParen = /\(([^()]*)\)\s*=>/g;
  while ((m = arrowParen.exec(code))) add(m[1]);
  const arrowBare = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g;
  while ((m = arrowBare.exec(code))) names.add(m[1]);
  const cat = /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g;
  while ((m = cat.exec(code))) names.add(m[1]);
  const cls = /\bclass\s+([A-Za-z_$][\w$]*)/g;
  while ((m = cls.exec(code))) names.add(m[1]);
  return names;
}

// every identifier CALLED as a plain function — not a method, not a property
function calledNames(code) {
  const names = new Set();
  const re = /(^|[^\w$.?])([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    // `new Foo(` is a constructor, and `.foo(` / `?.foo(` are members: both
    // excluded above. `function foo(` is a declaration, excluded here.
    const before = code.slice(Math.max(0, m.index - 12), m.index + m[1].length);
    if (/\b(function|new|class)\s*$/.test(before)) continue;
    names.add(m[2]);
  }
  return names;
}

(async () => {
  const findings = [];
  const say = (file, msg) => findings.push(file + ' :: ' + msg);
  const files = fs.readdirSync(DIR)
    .filter(f => f.endsWith('.js') && !NOT_A_CHECK.has(f))
    .sort();

  if (files.length < 15)
    say('tests/', 'only ' + files.length + ' check files found — this scan is looking in the wrong place');

  // ── the browser, once, to answer "does the page have this name" ──────────
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'], executablePath: chromePath() });
  const page = await b.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(APP, { waitUntil: 'load' });
  const appHas = async names => page.evaluate(list => {
    const r = {};
    list.forEach(n => { try { r[n] = typeof window[n]; } catch (e) { r[n] = 'threw'; } });
    return r;
  }, names);
  // the page must actually be the app, or every name below "resolves" as absent
  const sane = await appHas(['pertTE', 'recompute', 'planTruthData', 'fmtMoney']);
  if (Object.values(sane).some(v => v !== 'function')) {
    say('tests/', 'the loaded page does not look like the application (' + JSON.stringify(sane)
      + ') — every name would report missing and this check would be noise');
    console.log(JSON.stringify({ findings, aborted: true }, null, 1));
    await b.close();
    process.exitCode = 1;
    return;
  }

  const perFile = {};
  let totalResolved = 0;

  for (const f of files) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    const code = codeOnly(src);
    const rec = perFile[f] = { exitCode: false, evaluateBodies: 0, resolved: 0, missing: [] };

    // ── PROPERTY 1: it can report a failure ────────────────────────────────
    rec.exitCode = /process\.exitCode\s*=/.test(code) || /process\.exit\s*\(/.test(code);
    if (!rec.exitCode)
      say(f, 'sets no exit code, so everything it finds is printed to stdout and reported as a PASS — '
        + 'the commit gate and the mutation harness both judge by exit status, and seven sweeps were '
        + 'in exactly this state while counting as coverage');

    // ── PROPERTY 2: every call in page scope names something the page has ──
    const bodies = scan(code);
    rec.evaluateBodies = bodies.length;
    if (!bodies.length) continue;                    // a check with no page code is fine
    const fileDeclared = declaredNames(code);        // node-side helpers are in scope too
    for (const { start, end } of bodies) {
      const body = code.slice(start, end);
      const local = declaredNames(body);
      for (const name of calledNames(body)) {
        if (PROVIDED.has(name) || local.has(name) || fileDeclared.has(name)) continue;
        rec.missing.push(name);
      }
    }
    rec.missing = [...new Set(rec.missing)];
    if (rec.missing.length) {
      const kinds = await appHas(rec.missing);
      const absent = rec.missing.filter(n => kinds[n] !== 'function');
      rec.resolved = rec.missing.length - absent.length;
      totalResolved += rec.resolved;
      rec.missing = absent;
      absent.forEach(n => say(f, 'calls ' + n + '() inside a page.evaluate body and the application has no '
        + 'such function (typeof window.' + n + ' is "' + kinds[n] + '"). If that call sits in a branch that '
        + 'only runs when the check has something to REPORT, this file is green today and throws the first '
        + 'time it is right — which is what money() vs fmtMoney() did, eleven times over'));
    } else {
      rec.resolved = 0;
    }
  }

  /* ANTI-VACUUM. If the name extraction silently stops working — a regex that
     matches nothing, a scanner that finds no bodies — every file reports clean
     and this whole check becomes the thing it exists to catch. It has to show
     its working: real bodies found, and real application functions resolved
     through them. */
  const bodies = Object.values(perFile).reduce((s, r) => s + r.evaluateBodies, 0);
  if (bodies < 20)
    say('tests/', 'only ' + bodies + ' page.evaluate bodies were located across ' + files.length
      + ' checks — the scanner is not reading them, so property 2 passed by finding nothing');
  if (totalResolved < 30)
    say('tests/', 'only ' + totalResolved + ' calls were actually resolved against the application, so '
      + 'the name extraction is collecting almost nothing and this check is close to vacuous');

  // ── AND IT MUST STILL CATCH BOTH DEFECTS ─────────────────────────────────
  /* Planted into synthetic files, scanned by the same functions, because a
     linter that has gone blind reports a clean directory and a clean directory
     reports a clean directory. */
  const selfTest = {};
  {
    const good = `const { requirePlaywright, chromePath, APP } = require('./_harness');
      (async () => {
        const R = await page.evaluate(() => {
          const bad = [];
          const gap = budgetVerdict(1, 2, 3, 4).gap;
          if (gap > 0) bad.push('over by ' + fmtMoney(gap));
          return bad;
        });
        if (R.length) process.exitCode = 1;
      })();`;
    const noExit = good.replace('if (R.length) process.exitCode = 1;', 'console.log(R);');
    const badCall = good.replace('fmtMoney(gap)', 'money(gap)');

    const analyse = async src => {
      const code = codeOnly(src);
      const hasExit = /process\.exitCode\s*=/.test(code) || /process\.exit\s*\(/.test(code);
      const out = { hasExit, missing: [] };
      const fileDeclared = declaredNames(code);
      for (const { start, end } of scan(code)) {
        const body = code.slice(start, end);
        const local = declaredNames(body);
        for (const nm of calledNames(body))
          if (!PROVIDED.has(nm) && !local.has(nm) && !fileDeclared.has(nm)) out.missing.push(nm);
      }
      const kinds = await appHas([...new Set(out.missing)]);
      out.missing = [...new Set(out.missing)].filter(nm => kinds[nm] !== 'function');
      return out;
    };

    const g = await analyse(good), e = await analyse(noExit), c = await analyse(badCall);
    selfTest.cleanFile = { exit: g.hasExit, missing: g.missing };
    selfTest.noExitFile = { exit: e.hasExit };
    selfTest.badCallFile = { missing: c.missing };
    if (!g.hasExit) say('SELF-TEST', 'a file that plainly sets process.exitCode is read as not setting one');
    if (g.missing.length)
      say('SELF-TEST', 'a clean file reports missing names ' + g.missing.join(', ')
        + ' — this check produces false findings, which is how a linter gets ignored');
    if (e.hasExit) say('SELF-TEST', 'a file with its exit code REMOVED still reads as setting one, so '
      + 'property 1 cannot fail');
    if (!c.missing.includes('money'))
      say('SELF-TEST', 'money() planted in a reporting branch was NOT flagged, so property 2 cannot catch '
        + 'the defect it was written for');
  }

  await b.close();
  console.log(JSON.stringify({
    checksScanned: files.length,
    evaluateBodies: bodies,
    callsResolvedAgainstTheApp: totalResolved,
    selfTest,
    perFile: Object.fromEntries(Object.entries(perFile).map(([k, v]) =>
      [k, { exitCode: v.exitCode, bodies: v.evaluateBodies, resolved: v.resolved, missing: v.missing }])),
    findings,
  }, null, 1));
  if (findings.length) process.exitCode = 1;
})();
