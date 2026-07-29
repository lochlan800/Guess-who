/* Playing against the computer.
 *
 * The invariant that matters: the computer's list of who you might be must
 * always still contain your actual character. If a wrong answer or a bad
 * filter ever drops it, the computer ends up confidently guessing someone you
 * are not, which looks like cheating from the other side of the screen.
 *
 * So this plays whole games at every difficulty, checking after every single
 * answer, and checks it can be beaten as well as that it wins when left to.
 */
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8099/index.html';

const fail = [];
const check = (n, c, x) => { console.log((c?'  PASS  ':'  FAIL  ')+n+(x!==undefined?'  -> '+JSON.stringify(x):'')); if(!c) fail.push(n); };
const waitFor = async (p, fn, ms = 12000) => {
  const t = Date.now();
  while (Date.now() - t < ms){ if (await p.evaluate(fn)) return true; await p.waitForTimeout(100); }
  return false;
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('dialog', d => d.accept());
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { const t = m.text();
    if (m.type() === 'error' && !/ERR_TUNNEL|ERR_PROXY|ERR_NAME|ERR_CONNECTION|peerjs/i.test(t)) errs.push(t); });

  await p.goto(URL);
  await p.selectOption('#aiLevel', 'normal');
  await p.click('#btnAi');
  await p.waitForTimeout(300);

  check('a game against the computer starts', await p.evaluate(() => AI.on && S.phase === 'playing'));
  check('you go first', await p.evaluate(() => S.myTurn === true));
  check('you get your own character', await p.evaluate(() => !!S.mySecret));
  check('the computer has one too, and it is kept from you',
        await p.evaluate(() => !!AI.secret && S.theirSecret === null));
  check('it starts with all 24 possible', await p.evaluate(() => AI.candidates.length) === 24);
  check('the board starts unflipped', await p.evaluate(() => S.down.size) === 0);

  // ---- the computer answers from its own character, honestly ----
  const truth = await p.evaluate(() => !!AI.secret.glasses);
  await p.fill('#qInput', 'do they wear glasses');
  await p.click('#btnAsk');
  await p.waitForTimeout(200);
  check('it answers your question truthfully',
        (await p.evaluate(() => document.querySelector('#log').textContent)).includes(truth ? 'YES' : 'NO'),
        { itsCharacterHasGlasses: truth });
  check('asking does not flip your cards for you', await p.evaluate(() => S.down.size) === 0);
  check('you cannot ask twice in one turn', await p.evaluate(() => document.querySelector('#btnAsk').disabled));

  // ---- hand over; it asks something useful and narrows down ----
  const before = await p.evaluate(() => AI.candidates.length);
  await p.click('#btnPass');
  check('it takes its turn', await waitFor(p, () => S.myTurn === true));
  const after = await p.evaluate(() => AI.candidates.length);
  check('its question actually narrowed things down', after < before, { before, after });
  check('and it still thinks you might be who you are',
        await p.evaluate(() => AI.candidates.some(c => c.id === S.mySecret.id)));
  check('the turn comes back to you', await p.evaluate(() => S.myTurn && !S.pendingQ));

  // ---- play a whole game out at each difficulty ----
  for (const level of ['easy', 'normal', 'hard']){
    await p.goto(URL);
    await p.selectOption('#aiLevel', level);
    await p.click('#btnAi');
    await p.waitForTimeout(200);

    let rounds = 0, everLostTheTruth = false;
    while (rounds < 30 && await p.evaluate(() => S.phase === 'playing')){
      rounds++;
      // ask something, then hand over
      if (await p.evaluate(() => S.myTurn && !S.pendingQ)){
        await p.fill('#qInput', 'do they have a beard');
        await p.click('#btnAsk');
        await p.waitForTimeout(80);
      }
      if (await p.evaluate(() => S.phase !== 'playing')) break;
      await p.click('#btnPass');
      await waitFor(p, () => S.myTurn === true || S.phase !== 'playing');
      const ok = await p.evaluate(() =>
        S.phase !== 'playing' || AI.candidates.some(c => c.id === S.mySecret.id));
      if (!ok) everLostTheTruth = true;
    }
    check('[' + level + '] its shortlist never rules out your real character', !everLostTheTruth);
    check('[' + level + '] the game reaches an end', await p.evaluate(() => S.phase) === 'over', { rounds });
    const title = await p.evaluate(() => document.querySelector('#endTitle').textContent);
    check('[' + level + '] it announces a result', /win|lose/i.test(title), title);
    if (/lose/i.test(title)){
      check('[' + level + '] when it wins, it named the right person',
            await p.evaluate(() => document.querySelector('#log').textContent).then(t => t.includes("it's right")));
    }
  }

  // ---- a stray tap must never cost the game ----
  await p.goto(URL);
  await p.selectOption('#aiLevel', 'easy');
  await p.click('#btnAi');
  await p.waitForTimeout(200);
  await p.click('#btnGuess');
  check('there is an obvious way out of guessing',
        await p.evaluate(() => document.querySelector('#btnCancelGuess').offsetParent !== null));
  await p.click('#btnCancelGuess');
  check('backing out leaves the game running',
        await p.evaluate(() => S.phase === 'playing' && S.guessMode === false));

  await p.click('#btnGuess');
  await p.evaluate(() => document.querySelector('#board .tile[data-id="7"]').click());
  await p.waitForTimeout(200);
  check('tapping a character asks you to confirm first',
        await p.evaluate(() => document.querySelector('#guessModal').classList.contains('on')));
  check('the confirmation shows who you picked',
        (await p.evaluate(() => document.querySelector('#guessName').textContent)) === 'Greta');
  check('nothing has been decided yet', await p.evaluate(() => S.phase) === 'playing');
  await p.click('#btnGuessNo');
  await p.waitForTimeout(150);
  check('saying no does not end the game', await p.evaluate(() => S.phase) === 'playing');
  check('and you can still pick someone else', await p.evaluate(() => S.guessMode === true));
  await p.click('#btnCancelGuess');

  // ---- and you can beat it ----
  const itsId = await p.evaluate(() => AI.secret.id);
  await p.click('#btnGuess');
  await p.evaluate(id => document.querySelector('#board .tile[data-id="'+id+'"]').click(), itsId);
  await p.click('#btnGuessYes');
  await p.waitForTimeout(300);
  check('guessing its character correctly wins',
        (await p.evaluate(() => document.querySelector('#endTitle').textContent)).includes('win'));
  check('both characters are revealed',
        await p.evaluate(() => document.querySelectorAll('#endReveal .p').length) === 2);

  // ---- a wrong guess loses ----
  await p.click('#btnRematch');
  await p.waitForTimeout(300);
  check('play again starts a fresh game against it',
        await p.evaluate(() => AI.on && S.phase === 'playing' && AI.candidates.length === 24));
  const wrong = await p.evaluate(() => (AI.secret.id % 24) + 1);
  await p.click('#btnGuess');
  await p.evaluate(id => document.querySelector('#board .tile[data-id="'+id+'"]').click(), wrong);
  await p.click('#btnGuessYes');
  await p.waitForTimeout(300);
  check('a wrong guess loses', (await p.evaluate(() => document.querySelector('#endTitle').textContent)).includes('lose'));

  // ---- the computer can gamble before it is certain ----
  await p.goto(URL);
  await p.selectOption('#aiLevel', 'hard');
  await p.click('#btnAi');
  await p.waitForTimeout(200);
  const gambles = await p.evaluate(() => {
    let punts = 0;
    for (let i = 0; i < 400; i++){
      AI.level = 'hard'; AI.candidates = CHARACTERS.slice(0, 2);
      if (aiWantsToGuess()) punts++;
    }
    return punts;
  });
  check('with two names left it sometimes takes the shot rather than always asking',
        gambles > 40 && gambles < 360, { outOf400: gambles });
  const certain = await p.evaluate(() => {
    AI.candidates = CHARACTERS.slice(0, 1);
    return aiWantsToGuess();
  });
  check('with one name left it always guesses', certain === true);
  const early = await p.evaluate(() => {
    AI.level = 'hard'; AI.candidates = CHARACTERS.slice();
    let punts = 0;
    for (let i = 0; i < 200; i++) if (aiWantsToGuess()) punts++;
    return punts;
  });
  check('it does not throw the game away at 24 names', early === 0, early);

  // a losing gamble must hand you the win
  await p.evaluate(() => {
    AI.candidates = CHARACTERS.filter(c => c.id !== S.mySecret.id).slice(0, 1);
    S.myTurn = false;
    aiTakeTurn();
  });
  check('when its punt is wrong, you win',
        await waitFor(p, () => document.querySelector('#endTitle').textContent.includes('win')),
        await p.evaluate(() => document.querySelector('#endTitle').textContent));
  check('and the log says it guessed wrong',
        (await p.evaluate(() => document.querySelector('#log').textContent)).includes("it's wrong"));

  check('no javascript errors', errs.length === 0, errs.slice(0, 5));

  console.log('\n' + (fail.length ? 'FAILED: ' + fail.join(' | ') : 'ALL PASS'));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
