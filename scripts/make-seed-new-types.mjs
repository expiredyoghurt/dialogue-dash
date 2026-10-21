// Builds seed-new-types.sql and seed-new-types-extra.sql from scripts/seed-new-types-data.mjs.
// Every question goes through the same validator the teacher console uses, and every key is
// marked by the real checker before anything is written. INSERT-only: nothing existing is touched.
import { writeFileSync } from 'node:fs';
import { REQUIRED, EXTRA } from './seed-new-types-data.mjs';
import { validateQuestion } from '../src/teacher.js';
import { checkMode1 } from '../src/engine.js';
import { checkMode4, checkMode5, checkFix, tapTargets, allVariants } from '../src/modes.js';

const esc = (s) => String(s).replace(/'/g, "''");
// SQL string literal that never contains a raw line break (so every statement stays on one line).
const lit = (s) => '(' + String(s).split('\n').map((x) => `'${esc(x)}'`).join(' || char(10) || ') + ')';
const now = Date.now();
let problems = 0;
const bad = (m) => {
  console.error('SEED PROBLEM:', m);
  problems++;
};

// Curly quotes for everything pupils read or keys are compared with. Quotes alternate open / close and
// restart on each new line, as in scripts/make-seed.mjs.
const KEEP = new Set(['id', 'code', 'group']);
const curl = (s) => {
  let open = true;
  let out = '';
  for (const ch of s) {
    if (ch === '"') {
      out += open ? '“' : '”';
      open = !open;
    } else if (ch === "'") out += '’';
    else {
      out += ch;
      if (ch === '\n') open = true;
    }
  }
  return out;
};
const deep = (v, key) => {
  if (typeof v === 'string') return KEEP.has(key) ? v : curl(v);
  if (Array.isArray(v)) return v.map((x) => deep(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, k)]));
  return v;
};

const guard = (mode, d) => {
  const j = (path, val) => `json_extract(data, '$.${path}') = ${lit(val)}`;
  const jn = (path, val) => `COALESCE(json_extract(data, '$.${path}'), '') = ${lit(val ?? '')}`;
  if (mode === 1) return j('correct', d.correct);
  if (mode === 4) return `${j('stem', d.stem)} AND ${jn('context', d.context)}`;
  if (mode === 5) return `${j('prompt', d.prompt)} AND ${j('instruction', d.instruction)}`;
  if (mode === 6) return j('sentence', d.sentence);
  throw new Error('mode');
};

function selfCheck(mode, d, label) {
  if (mode === 1) {
    if (!checkMode1(d, d.correct).correct) bad(`${label}: key doesn't mark itself correct`);
    const r = checkMode1(d, d.prompt);
    if (r.correct) bad(`${label}: prompt is already correct`);
    if (d.lines && !(r.codes.length && r.codes.every((c) => c === 'NO_NEW_LINE'))) bad(`${label}: lines prompt should only be missing line breaks, got ${r.codes}`);
    if (d.beat) {
      const comma = d.correct.replace('. “', ', “');
      const rc = checkMode1(d, comma);
      if (rc.correct || !rc.codes.includes('ACTION_COMMA') || rc.codes.includes('NO_COMMA_BEFORE')) bad(`${label}: comma variant should give ACTION_COMMA only, got ${rc.codes}`);
    }
  }
  if (mode === 4) {
    const ids = d.options.map((o) => o.id);
    if (d.pick === 1) {
      for (const id of ids) if (checkMode4(d, [id]).correct !== d.correct.includes(id)) bad(`${label}: option ${id} marked wrongly`);
    } else {
      for (let i = 0; i < ids.length; i++)
        for (let k = i + 1; k < ids.length; k++) {
          const want = d.correct.includes(ids[i]) && d.correct.includes(ids[k]);
          if (checkMode4(d, [ids[i], ids[k]]).correct !== want) bad(`${label}: pair ${ids[i]}${ids[k]} marked wrongly`);
        }
    }
    if (ids.length - d.correct.length < 1) bad(`${label}: no distractor`);
    if (d.options.some((o) => !d.correct.includes(o.id) && !o.why)) bad(`${label}: a distractor has no "why" note`);
  }
  if (mode === 5) {
    for (const v of allVariants(d)) if (!checkMode5(d, v).correct) bad(`${label}: accepted variant fails: ${v}`);
    if (checkMode5(d, d.prompt).correct) bad(`${label}: the unchanged prompt is accepted`);
  }
  if (mode === 6) {
    if (!tapTargets(d).length) bad(`${label}: no tap target`);
    for (const f of d.fixes) if (!checkFix(d, f).ok) bad(`${label}: fix ${f} fails`);
    for (const w of d.wrong) if (checkFix(d, w).ok) bad(`${label}: the wrong word is accepted as a fix`);
  }
}

const seen = new Set();
function build(list, name) {
  const sql = [];
  list.forEach(({ mode, data }, i) => {
    const label = `${name}#${i + 1} (mode ${mode})`;
    let d;
    try {
      d = validateQuestion(mode, deep(data), {});
    } catch (e) {
      bad(`${label}: ${e.message}`);
      return;
    }
    // validateQuestion drops nothing the seeds rely on, except Mode 1's empty alts which we keep.
    const key = `${mode}|${guard(mode, d)}`;
    if (seen.has(key)) return bad(`${label}: duplicate question`);
    seen.add(key);
    selfCheck(mode, d, label);
    sql.push(`INSERT INTO questions (mode, class_id, public, active, data, created_at) SELECT ${mode}, NULL, 1, 1, '${esc(JSON.stringify(d))}', ${now} WHERE NOT EXISTS (SELECT 1 FROM questions WHERE mode = ${mode} AND ${guard(mode, d)});`);
  });
  return sql;
}

const counts = (list) => list.reduce((c, q) => ((c[q.mode] = (c[q.mode] || 0) + 1), c), {});
const req = build(REQUIRED, 'required');
const extra = build(EXTRA, 'extra');
if (REQUIRED.length !== 9) bad(`expected 9 required questions, got ${REQUIRED.length}`);
if (EXTRA.length !== 45) bad(`expected 45 extra questions, got ${EXTRA.length}`);

const head = (title, n) => [
  `-- ${title}: ${n} questions. Generated by scripts/make-seed-new-types.mjs.`,
  '-- INSERT-only and safe to re-run: a question is added only if the same question is not already in the table.',
  '-- Existing questions, ids, teacher-authored data and pupil results are never changed.',
  '-- Deploy the v1.1 Worker BEFORE running this file (older versions cannot mark these questions).',
];
writeFileSync(new URL('../seed-new-types.sql', import.meta.url), [...head('Dialogue Dash v1.1 seed: the nine new questions from the brief', req.length), ...req].join('\n') + '\n');
writeFileSync(new URL('../seed-new-types-extra.sql', import.meta.url), [...head('Dialogue Dash v1.1 EXTRA items for review (5 per type)', extra.length), ...extra].join('\n') + '\n');
console.log('required', req.length, JSON.stringify(counts(REQUIRED)), '| extra', extra.length, JSON.stringify(counts(EXTRA)));
if (problems) {
  console.error(`${problems} problem(s).`);
  process.exit(1);
}
