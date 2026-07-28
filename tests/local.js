/* Two players, one device, no connection of any kind.
 *
 * This is the mode that has to work on a plane, so the test runs a whole game
 * — deal, ask, answer, flip, pass, guess — and checks the thing that matters
 * most besides the rules: that neither player is shown the other's board or
 * secret when the device changes hands.
 */
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8099/index.html';

const fail = [];
const check = (n, c, x) => { console.log((c?'  PASS  ':'  FAIL  ')+n+(x!==undefined?'  -> '+JSON.stringify(x):'')); if(!c) fail.push(n); };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { const t = m.text();
    if (m.type() === 'error' && !/ERR_TUNNEL|ERR_PROXY|ERR_NAME|ERR_CONNECTION|peerjs/i.test(t)) errs.push(t); });

  await p.goto(URL);
  await p.click('#btnLocal');
  await p.fill('#p1Name', 'Lochlan');
  await p.fill('#p2Name', 'Sam');
  await p.click('#btnLocalStart');
  await p.waitForTimeout(300);

  check('the game starts with the board hidden',
        await p.evaluate(() => document.querySelector('#coverModal').classList.contains('on')));
  check('the board is genuinely not visible behind the cover',
        await p.evaluate(() => getComputedStyle(document.querySelector('#board')).visibility === 'hidden'));
  check('it names who should be holding it',
        (await p.evaluate(() => document.querySelector('#coverTitle').textContent)).includes('Lochlan'));
  check('each player got their own secret',
        await p.evaluate(() => L.players.length === 2 && !!L.players[0].secret && !!L.players[1].secret));
  check('no network connection is involved', await p.evaluate(() => S.conn === null));

  // ---- first player's turn ----
  await p.click('#btnCoverReady');
  await p.waitForTimeout(200);
  check('the board appears once ready',
        await p.evaluate(() => !document.querySelector('#coverModal').classList.contains('on')));
  const p1secret = await p.evaluate(() => S.mySecret.name);
  check('the holder sees their own secret',
        (await p.evaluate(() => document.querySelector('#secretName').textContent)) === p1secret);
  check('the turn bar names the holder',
        (await p.evaluate(() => document.querySelector('#turnText').textContent)).includes('Lochlan'));

  // ask a question; the device answers for the other player, truthfully
  const truth = await p.evaluate(() => !!L.players[1].secret.glasses);
  await p.fill('#qInput', 'do they wear glasses');
  await p.click('#btnAsk');
  await p.waitForTimeout(250);
  const log1 = await p.evaluate(() => document.querySelector('#log').textContent);
  check('the question is answered from the other player\'s character',
        log1.includes(truth ? 'YES' : 'NO'), { expected: truth ? 'YES' : 'NO' });
  check('the log shows the words that were typed', log1.includes('do they wear glasses'));

  // the board must not move on its own here either
  check('nothing is flipped automatically', await p.evaluate(() => S.down.size) === 0);
  await p.evaluate(() => { [1,2,3].forEach(id => document.querySelector('#board .tile[data-id="'+id+'"]').click()); });
  check('the player can flip cards by hand', await p.evaluate(() => S.down.size) === 3);

  // ---- hand over ----
  await p.click('#btnPass');
  await p.waitForTimeout(200);
  check('handing over hides the board again',
        await p.evaluate(() => document.querySelector('#coverModal').classList.contains('on')));
  check('and the previous player\'s board is not visible through it',
        await p.evaluate(() => getComputedStyle(document.querySelector('#board')).visibility === 'hidden'
                            && getComputedStyle(document.querySelector('#secretName')).visibility === 'hidden'));
  check('it now asks for the second player',
        (await p.evaluate(() => document.querySelector('#coverTitle').textContent)).includes('Sam'));

  await p.click('#btnCoverReady');
  await p.waitForTimeout(200);
  const p2secret = await p.evaluate(() => S.mySecret.name);
  check('the second player sees their own secret, not the first\'s',
        (await p.evaluate(() => document.querySelector('#secretName').textContent)) === p2secret);
  check('the two players have separate boards',
        await p.evaluate(() => S.down.size) === 0);
  check('each keeps their own flipped cards',
        await p.evaluate(() => L.players[0].down.size) === 3 && await p.evaluate(() => L.players[1].down.size) === 0);
  check('the second player can see how many the first has left',
        (await p.evaluate(() => document.querySelector('#theirCount').textContent)).includes('21'));

  // ---- second player guesses wrong ----
  const wrongId = await p.evaluate(() => (L.players[0].secret.id % 24) + 1);
  await p.click('#btnGuess');
  await p.evaluate(id => document.querySelector('#board .tile[data-id="'+id+'"]').click(), wrongId);
  await p.waitForTimeout(300);
  check('a wrong guess ends the game',
        (await p.evaluate(() => document.querySelector('#endTitle').textContent)).length > 0);
  check('the loser is the one who guessed',
        (await p.evaluate(() => document.querySelector('#endTitle').textContent)).includes('lose'));
  check('both characters are revealed at the end',
        await p.evaluate(() => document.querySelectorAll('#endReveal .p').length) === 2);

  // ---- play again keeps the same two players ----
  await p.click('#btnRematch');
  await p.waitForTimeout(300);
  check('play again deals a fresh game',
        await p.evaluate(() => S.phase === 'playing' && L.players[0].down.size === 0));
  check('play again keeps the names',
        await p.evaluate(() => L.players[0].name) === 'Lochlan' && await p.evaluate(() => L.players[1].name) === 'Sam');
  check('and hides the board for the handover',
        await p.evaluate(() => document.querySelector('#coverModal').classList.contains('on')));

  check('no javascript errors', errs.length === 0, errs.slice(0, 5));

  console.log('\n' + (fail.length ? 'FAILED: ' + fail.join(' | ') : 'ALL PASS'));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
