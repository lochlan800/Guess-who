const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:8099/index.html';
const SHOT = '/tmp/claude-0/-home-user-Guess-who/b453ac1f-0ec5-56c4-8dba-474fb2cbfd70/scratchpad/';

const fail = [];
function check(name, cond, extra) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''));
  if (!cond) fail.push(name);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } , serviceWorkers: 'block' });
  const A = await ctx.newPage();
  const B = await ctx.newPage();

  const errors = [];
  for (const [nm, p] of [['A', A], ['B', B]]) {
    p.on('dialog', d => d.accept());        // the reset guard asks before clearing
    p.on('pageerror', e => errors.push(nm + ' pageerror: ' + e.message));
    p.on('console', m => {
      const t = m.text();
      // the sandbox blocks the matchmaking server; that's a network failure, not a code fault
      if (m.type() === 'error' && !/ERR_TUNNEL|ERR_PROXY|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|peerjs/i.test(t))
        errors.push(nm + ' console: ' + t);
    });
  }

  await A.goto(URL); await B.goto(URL);
  await A.waitForTimeout(300);

  check('PeerJS library loaded', await A.evaluate(() => typeof Peer !== 'undefined'));
  check('24 characters defined', await A.evaluate(() => CHARACTERS.length) === 24);
  check('all character ids unique', await A.evaluate(() => new Set(CHARACTERS.map(c => c.id)).size) === 24);

  // Every question must split the deck (no useless questions), and no two
  // characters may be indistinguishable, or the game could be unwinnable.
  const qStats = await A.evaluate(() => QUESTIONS.map(q => ({ id: q.id, yes: CHARACTERS.filter(c => q.test(c)).length })));
  const dud = qStats.filter(q => q.yes === 0 || q.yes === 24);
  check('every question splits the board', dud.length === 0, dud);

  const dupes = await A.evaluate(() => {
    const sig = c => QUESTIONS.map(q => (q.test(c) ? 1 : 0)).join('');
    const seen = {}, out = [];
    CHARACTERS.forEach(c => { const s = sig(c); if (seen[s]) out.push([seen[s], c.name]); else seen[s] = c.name; });
    return out;
  });
  check('no two characters are identical', dupes.length === 0, dupes);

  // ---- stub the transport: relay messages between the two real pages ----
  const setup = async (page, host, name, them) => page.evaluate(([host, name, them]) => {
    window.__out = [];
    S.myName = name; S.theirName = them; S.isHost = host;
    S.conn = { open: true, send: m => window.__out.push(m), close() {} };
    document.querySelector('#connPill').style.display = '';
    setConnPill(true);
  }, [host, name, them]);

  await setup(A, true, 'Alice', 'Bob');
  await setup(B, false, 'Bob', 'Alice');

  // pump: drain one page's outbox into the other
  const pump = async (from, to) => {
    const msgs = await from.evaluate(() => { const m = window.__out; window.__out = []; return m; });
    for (const m of msgs) await to.evaluate(msg => handleMessage(msg), m);
    return msgs;
  };

  // host starts the game -> guest receives "start"
  await A.evaluate(() => startNewGame(true));
  await pump(A, B);

  check('host is on the game screen', await A.evaluate(() => document.querySelector('#scGame').classList.contains('on')));
  check('guest is on the game screen', await B.evaluate(() => document.querySelector('#scGame').classList.contains('on')));
  check('board rendered 24 tiles', await A.evaluate(() => document.querySelectorAll('#board .tile').length) === 24);
  check('faces render as svg', await A.evaluate(() => document.querySelectorAll('#board .tile svg').length) === 24);

  const turns = await Promise.all([A.evaluate(() => S.myTurn), B.evaluate(() => S.myTurn)]);
  check('exactly one player has the turn', turns[0] !== turns[1], turns);

  // force known secrets + a known turn order so the rest is deterministic
  await A.evaluate(() => { S.mySecret = byId(2);  renderSecret(); S.myTurn = true;  renderTurn(); }); // Bella
  await B.evaluate(() => { S.mySecret = byId(8);  renderSecret(); S.myTurn = false; renderTurn(); }); // Hugo

  check('secret shown in side panel', (await A.evaluate(() => document.querySelector('#secretName').textContent)) === 'Bella');

  // ---- Round 1: Alice asks about glasses; Hugo has none -> NO ----
  await A.evaluate(() => { document.querySelector('#qInput').value = 'do they wear glasses'; updateReading(); document.querySelector('#btnAsk').click(); });
  await pump(A, B);                       // ask -> B
  await pump(B, A);                       // answer (+ eliminated) -> A

  // Working out who is ruled out is the player's job — the board must not
  // move on its own, however obvious the deduction is.
  const downA = await A.evaluate(() => [...S.down]);
  check('the board does not flip itself after an answer', downA.length === 0, downA);
  check('no tiles went down in the DOM either',
        await A.evaluate(() => document.querySelectorAll('#board .tile.down').length) === 0);
  check('counter still shows everyone standing',
        (await A.evaluate(() => document.querySelector('#remainCount').textContent)) === '24 still standing');
  check('answer logged as NO', (await A.evaluate(() => document.querySelector('#log').textContent)).includes('NO'));
  check('the log shows the question as it was typed',
        (await A.evaluate(() => document.querySelector('#log').textContent)).includes('do they wear glasses'));
  await pump(A, B);
  check('turn passed to Bob (A no longer has it)', (await A.evaluate(() => S.myTurn)) === false);
  check('Bob now has the turn', (await B.evaluate(() => S.myTurn)) === true);
  check('ask button disabled when not your turn', await A.evaluate(() => document.querySelector('#btnAsk').disabled));

  // the player flips them by hand, and that count reaches the opponent
  const withGlasses = await A.evaluate(() => CHARACTERS.filter(c => c.glasses).map(c => c.id));
  await A.evaluate(ids => ids.forEach(id => document.querySelector('#board .tile[data-id="' + id + '"]').click()), withGlasses);
  check('flipping by hand updates the count',
        (await A.evaluate(() => S.down.size)) === withGlasses.length);
  await pump(A, B);
  check("Bob's view of Alice's count updated",
        (await B.evaluate(() => document.querySelector('#theirCount').textContent)).includes(String(24 - withGlasses.length)));

  // ---- Round 2: Bob asks "female?"; Bella is female -> YES ----
  await B.evaluate(() => { document.querySelector('#qInput').value = 'is your person female'; updateReading(); document.querySelector('#btnAsk').click(); });
  await pump(B, A);
  await pump(A, B);

  check('a YES answer is logged as YES',
        (await B.evaluate(() => document.querySelector('#log').textContent)).includes('YES'));
  check("Bob's board is still untouched by the answer",
        (await B.evaluate(() => S.down.size)) === 0);
  check('turn came back to Alice', (await A.evaluate(() => S.myTurn)) === true);

  // ---- manual flip / unflip still works ----
  const before = await A.evaluate(() => S.down.size);
  await A.evaluate(() => document.querySelector('#board .tile:not(.down)').click());
  const after = await A.evaluate(() => S.down.size);
  check('clicking a tile flips it down', after === before + 1);
  await A.evaluate(() => { const t = [...document.querySelectorAll('#board .tile.down')].pop(); t.click(); });
  check('clicking again flips it back up', (await A.evaluate(() => S.down.size)) === before, await A.evaluate(() => S.down.size));
  await A.evaluate(() => { document.querySelector('#btnResetBoard').click(); });
  check('reset board clears every flip', (await A.evaluate(() => S.down.size)) === 0);
  await pump(A, B);

  await A.screenshot({ path: SHOT + 'game.png' });

  // ---- wrong guess loses ----
  await A.evaluate(() => { S.down.clear(); refreshBoard(); document.querySelector('#btnGuess').click(); });
  check('guess mode highlights the board', await A.evaluate(() => document.querySelectorAll('#board .tile.pick').length) === 24);
  await A.evaluate(() => document.querySelector('#board .tile[data-id="3"]').click()); // Carlos, wrong
  await pump(A, B);   // guess -> B
  await pump(B, A);   // result -> A
  check('wrong guesser loses', (await A.evaluate(() => document.querySelector('#endTitle').textContent)).includes('lose'));
  check('opponent wins', (await B.evaluate(() => document.querySelector('#endTitle').textContent)).includes('win'));
  check('loser sees both characters revealed', await A.evaluate(() => document.querySelectorAll('#endReveal .p').length) === 2);
  check('winner sees both characters revealed', await B.evaluate(() => document.querySelectorAll('#endReveal .p').length) === 2);
  check('game phase is over', (await A.evaluate(() => S.phase)) === 'over');
  await A.screenshot({ path: SHOT + 'lose.png' });

  // ---- rematch: both accept -> fresh game ----
  await B.evaluate(() => document.querySelector('#btnRematch').click());
  await pump(B, A);
  check('rematch request shown to opponent',
        (await A.evaluate(() => document.querySelector('#rematchNote').textContent)).includes('rematch'));
  await A.evaluate(() => document.querySelector('#btnRematch').click());
  await pump(A, B);
  await pump(B, A);
  check('rematch resets the board', (await A.evaluate(() => S.down.size)) === 0);
  check('rematch closes the end modal', await A.evaluate(() => !document.querySelector('#endModal').classList.contains('on')));
  check('rematch resumes play on both sides',
        (await A.evaluate(() => S.phase)) === 'playing' && (await B.evaluate(() => S.phase)) === 'playing');
  const t2 = await Promise.all([A.evaluate(() => S.myTurn), B.evaluate(() => S.myTurn)]);
  check('rematch gives the turn to exactly one player', t2[0] !== t2[1], t2);

  // ---- correct guess wins ----
  await A.evaluate(() => { S.mySecret = byId(2); renderSecret(); S.myTurn = true; renderTurn(); });
  await B.evaluate(() => { S.mySecret = byId(8); renderSecret(); S.myTurn = false; renderTurn(); });
  await A.evaluate(() => { document.querySelector('#btnGuess').click(); document.querySelector('#board .tile[data-id="8"]').click(); });
  await pump(A, B);
  await pump(B, A);
  check('correct guesser wins', (await A.evaluate(() => document.querySelector('#endTitle').textContent)).includes('win'));
  check('their opponent loses', (await B.evaluate(() => document.querySelector('#endTitle').textContent)).includes('lose'));
  await A.screenshot({ path: SHOT + 'win.png' });

  // ---- chat ----
  await A.evaluate(() => { document.querySelector('#chatInput').value = 'good game!'; document.querySelector('#btnChat').click(); });
  await pump(A, B);
  check('chat arrives on the other side', (await B.evaluate(() => document.querySelector('#log').textContent)).includes('good game!'));

  // ---- home + lobby screens render ----
  const C = await ctx.newPage();
  await C.goto(URL);
  await C.screenshot({ path: SHOT + 'home.png' });
  await C.goto(URL + '?room=WXYZ');
  await C.waitForTimeout(200);
  check('?room= link prefills the code', (await C.evaluate(() => document.querySelector('#codeInput').value)) === 'WXYZ');
  await C.evaluate(() => { show('lobby'); document.querySelector('#lobbyCode').textContent = 'WXYZ';
                           document.querySelector('#shareUrl').textContent = location.origin + '/index.html?room=WXYZ'; });
  await C.screenshot({ path: SHOT + 'lobby.png' });

  check('no javascript errors', errors.length === 0, errors.slice(0, 6));

  console.log('\n' + (fail.length ? 'FAILED: ' + fail.join(' | ') : 'ALL ' + '✓'));
  await browser.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
