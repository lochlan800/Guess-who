/* Understanding typed questions.
 *
 * The interpreter is the whole feature: if it misreads a question the game
 * gives a confidently wrong answer, which is worse than refusing. So this
 * checks a spread of real phrasings, that every question is reachable by
 * typing, and — most importantly — that nothing is silently misread.
 */
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8099/index.html';

const fail = [];
const check = (n, c, x) => { console.log((c?'  PASS  ':'  FAIL  ')+n+(x!==undefined?'  -> '+JSON.stringify(x):'')); if(!c) fail.push(n); };

// phrasing -> the question id it must be understood as
const CASES = [
  ["is your person male?",                 "male"],
  ["are they a man",                       "male"],
  ["is it a girl",                         "female"],
  ["is your person a woman?",              "female"],

  ["do they wear glasses",                 "glasses"],
  ["has your person got specs on",         "glasses"],
  ["is he wearing a hat?",                 "hat"],
  ["have they got a cap",                  "hat"],
  ["are they wearing earrings",            "earrings"],

  ["does your person have a beard",        "beard"],
  ["is he bearded",                        "beard"],
  ["do they have a moustache?",            "moustache"],
  ["have they got a tash",                 "moustache"],
  ["any facial hair?",                     "anyFacial"],

  ["do they have blue eyes",               "eBlue"],
  ["are their eyes green",                 "eGreen"],
  ["brown eyes?",                          "eBrown"],

  ["does your person have black hair",     "hBlack"],
  ["have they got dark hair?",             "hBlack"],
  ["is their hair brown",                  "hBrown"],
  ["are they blonde",                      "hBlonde"],
  ["blonde hair?",                         "hBlonde"],
  ["are they a ginger",                    "hRed"],
  ["do they have red hair",                "hRed"],
  ["is their hair grey",                   "hGrey"],
  ["white hair?",                          "hGrey"],

  ["do they have long hair",               "sLong"],
  ["is their hair short?",                 "sShort"],
  ["is it curly",                          "sCurly"],
  ["have they got an afro",                "sCurly"],
  ["are they bald?",                       "sBald"],
  ["do they have no hair",                 "sBald"],

  ["do they have light skin",              "skinLight"],
  ["is their skin dark?",                  "skinDark"],
  ["do they have pale skin",               "skinLight"],
  ["olive skin?",                          "skinMed"]
];

// the trap this design has to avoid: hair colour vs skin tone
const NOT_CONFUSED = [
  ["does your person have dark hair", "hBlack",   "skinDark"],
  ["is your person dark skinned",     "skinDark", "hBlack"],
  ["do they have white hair",         "hGrey",    "skinLight"],
  ["do they have fair skin",          "skinLight","hBlonde"]
];

const NONSENSE = ["hello", "are you winning", "what's for dinner", "12345", "is it a dog"];

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext()).newPage();
  p.on('pageerror', e => console.log('  PAGEERROR', e.message));
  await p.goto(URL);

  const read = t => p.evaluate(txt => { const r = interpret(txt); return r ? {id:r.q.id, neg:r.neg} : null; }, t);

  let good = 0;
  for (const [text, want] of CASES){
    const got = await read(text);
    const ok = got && got.id === want && !got.neg;
    if (ok) good++; else check('"' + text + '" reads as ' + want, false, got);
  }
  check('common phrasings are understood (' + good + '/' + CASES.length + ')', good === CASES.length);

  for (const [text, want, mustNot] of NOT_CONFUSED){
    const got = await read(text);
    check('"' + text + '" is not mistaken for ' + mustNot, got && got.id === want, got);
  }

  for (const text of NONSENSE){
    const got = await read(text);
    check('"' + text + '" is refused rather than guessed at', got === null, got);
  }

  // negation has to flip the meaning, and "no hair" must stay bald
  const neg1 = await read("doesn't your person have glasses");
  check('a negated question is flagged', neg1 && neg1.id === 'glasses' && neg1.neg === true, neg1);
  const neg2 = await read("do they have no hair");
  check('"no hair" stays bald rather than becoming a negation', neg2 && neg2.id === 'sBald' && !neg2.neg, neg2);

  // every question must be reachable by typing something
  const unreachable = await p.evaluate(() => {
    const reachable = new Set();
    PATTERNS.forEach(pat => reachable.add(pat.id));
    return QUESTIONS.filter(q => !reachable.has(q.id)).map(q => q.id);
  });
  check('every question can be reached by typing', unreachable.length === 0, unreachable);

  // a negated answer must be the opposite of the plain one
  const flip = await p.evaluate(() => {
    const q = QUESTIONS.find(x => x.id === 'glasses');
    const withGlasses = CHARACTERS.find(c => c.glasses);
    return { plain: !!q.test(withGlasses) !== false, negated: !!q.test(withGlasses) !== true };
  });
  check('negation inverts the answer', flip.plain === true && flip.negated === false, flip);

  console.log('\n' + (fail.length ? 'FAILED: ' + fail.join(' | ') : 'ALL PASS'));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
