// Makes the "faulty" version of a Mode 2 dialogue by breaking punctuation, capitals and speech marks
// (never the words). Deterministic: the same input always gives the same output.
const O = '“';
const C = '”';
const nth = (m, n) => m[n % m.length];

const OPS = {
  noEnd: (s, n) => {
    const m = [...s.matchAll(new RegExp(`[.!?](?=${C})`, 'g'))];
    if (!m.length) return null;
    const x = nth(m, n);
    return s.slice(0, x.index) + s.slice(x.index + 1);
  },
  wrongEnd: (s, n) => {
    const m = [...s.matchAll(new RegExp(`[!?](?=${C})`, 'g'))];
    if (!m.length) return null;
    const x = nth(m, n);
    return s.slice(0, x.index) + '.' + s.slice(x.index + 1);
  },
  lowerFirst: (s, n) => {
    const m = [...s.matchAll(new RegExp(`${O}([A-Z])([A-Za-z’]*)`, 'g'))].filter((x) => !/^I(’|$)/.test(x[1] + x[2]));
    if (!m.length) return null;
    const x = nth(m, n);
    const i = x.index + 1;
    return s.slice(0, i) + x[1].toLowerCase() + s.slice(i + 1);
  },
  tagPeriod: (s, n) => {
    const m = [...s.matchAll(new RegExp(`,${C}(?= [a-z])`, 'g'))];
    if (!m.length) return null;
    const x = nth(m, n);
    return s.slice(0, x.index) + '.' + C + s.slice(x.index + 2);
  },
  outside: (s, n) => {
    const m = [...s.matchAll(new RegExp(`,${C}(?= [a-z])`, 'g'))];
    if (!m.length) return null;
    const x = nth(m, n);
    return s.slice(0, x.index) + C + ',' + s.slice(x.index + 2);
  },
  noCommaBefore: (s, n) => {
    const m = [...s.matchAll(new RegExp(`([a-z]), ${O}`, 'g'))];
    if (!m.length) return null;
    const x = nth(m, n);
    return s.slice(0, x.index + 1) + s.slice(x.index + 2);
  },
  capTag: (s, n) => {
    const m = [...s.matchAll(new RegExp(`,${C} ([a-z])`, 'g'))];
    if (!m.length) return null;
    const x = nth(m, n);
    const i = x.index + 3;
    return s.slice(0, i) + x[1].toUpperCase() + s.slice(i + 1);
  },
  resumeCap: (s, n) => {
    const m = [...s.matchAll(new RegExp(`, ${O}([a-z])`, 'g'))];
    if (!m.length) return null;
    const x = nth(m, n);
    const i = x.index + 3;
    return s.slice(0, i) + x[1].toUpperCase() + s.slice(i + 1);
  },
  sentLower: (s, n) => {
    const m = [...s.matchAll(new RegExp(`\\. ${O}([A-HJ-Z])`, 'g'))];
    if (!m.length) return null;
    const x = nth(m, n);
    const i = x.index + 3;
    return s.slice(0, i) + x[1].toLowerCase() + s.slice(i + 1);
  },
  dropQuotes: (s, n) => {
    const m = [...s.matchAll(new RegExp(`${O}[^${C}]*${C}`, 'g'))];
    if (!m.length) return null;
    const x = nth(m, n);
    return s.slice(0, x.index) + x[0].slice(1, -1) + s.slice(x.index + x[0].length);
  },
  noOpen: (s, n) => {
    const m = [...s.matchAll(new RegExp(O, 'g'))];
    if (m.length < 1) return null;
    const x = nth(m, n);
    return s.slice(0, x.index) + s.slice(x.index + 1);
  },
  noClose: (s, n) => {
    const m = [...s.matchAll(new RegExp(C, 'g'))];
    if (m.length < 1) return null;
    const x = nth(m, n);
    return s.slice(0, x.index) + s.slice(x.index + 1);
  },
  apos: (s, n) => {
    const m = [...s.matchAll(/([A-Za-z])’(s|t|m|ll|re|ve|d)\b/g)];
    if (!m.length) return null;
    const x = nth(m, n);
    return s.slice(0, x.index + 1) + s.slice(x.index + 2);
  },
};

// Faults are applied in a per-question shuffled order until the wanted number have taken effect.
// Targets cycle through 3, 4, 2, 3, 4 faults so the bank mixes easier and harder questions.
const NAMES = Object.keys(OPS);
const TARGETS = [3, 4, 2, 3, 4];

function order(index) {
  let x = (index + 1) * 2654435761 >>> 0;
  const a = [...NAMES];
  for (let i = a.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function corrupt(correct, index, validate) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const base = order(index + attempt * 101);
    for (let want = TARGETS[index % TARGETS.length]; want >= 2; want--) {
      let s = correct;
      const used = [];
      base.forEach((op, j) => {
        if (used.length >= want) return;
        const r = OPS[op](s, index + j);
        if (r != null && r !== s) {
          s = r;
          used.push(op);
        }
      });
      if (used.length >= 2 && s !== correct && validate(s)) return { faulty: s, profile: used.sort().join('+') };
    }
  }
  return null;
}
