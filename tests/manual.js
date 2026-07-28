/* Manual connect, end to end, with nothing faked.
 *
 * Two real tabs complete a real WebRTC handshake by passing the invite and
 * reply blobs between them, exactly as two players would paste them into a
 * chat app. No matchmaking server and no stubbed transport: the tabs connect
 * over local ICE candidates, so this runs with no external network at all —
 * which is the whole point, since the network is what could never be tested.
 */
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8099/index.html';

const fail = [];
const check = (n, c, x) => { console.log((c?'  PASS  ':'  FAIL  ')+n+(x!==undefined?'  -> '+JSON.stringify(x):'')); if(!c) fail.push(n); };
const waitFor = async (pg, fn, ms = 15000) => {
  const t = Date.now();
  while (Date.now() - t < ms){ if (await pg.evaluate(fn)) return true; await pg.waitForTimeout(120); }
  return false;
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const A = await ctx.newPage();   // invites
  const B = await ctx.newPage();   // replies

  const errs = [];
  for (const [nm, p] of [['A', A], ['B', B]]){
    p.on('pageerror', e => errs.push(nm + ' pageerror: ' + e.message));
    p.on('console', m => {
      const t = m.text();
      if (m.type() === 'error' && !/ERR_TUNNEL|ERR_PROXY|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|peerjs/i.test(t))
        errs.push(nm + ' console: ' + t);
    });
  }

  await A.goto(URL); await B.goto(URL);
  await A.waitForTimeout(300);

  // ---------- Player A makes an invite ----------
  await A.fill('#nameInput', 'Ann');
  await A.click('#btnManual');
  check('manual screen opens', await A.evaluate(() => document.querySelector('#scManual').classList.contains('on')));
  await A.click('#btnMakeInvite');

  const gotInvite = await waitFor(A, () => document.querySelector('#inviteOut').value.length > 40);
  check('an invite is produced', gotInvite);
  const invite = await A.evaluate(() => document.querySelector('#inviteOut').value);
  check('invite is a single pasteable block', /^GW1:[a-zA-Z0-9+/=]+$/.test(invite),
        { length: invite.length, head: invite.slice(0, 24) });
  console.log('    invite length:', invite.length, 'chars');

  // ---------- Player B pastes it and replies ----------
  await B.fill('#nameInput', 'Ben');
  await B.click('#btnManual');
  await B.click('#btnHaveInvite');
  await B.fill('#inviteIn', invite);
  await B.click('#btnMakeReply');

  const gotReply = await waitFor(B, () => document.querySelector('#replyOut').value.length > 40);
  check('a reply is produced', gotReply);
  const reply = await B.evaluate(() => document.querySelector('#replyOut').value);
  check('reply is a single pasteable block', /^GW1:[a-zA-Z0-9+/=]+$/.test(reply));

  // ---------- Player A pastes the reply ----------
  await A.fill('#replyIn', reply);
  await A.click('#btnUseReply');

  check('A connects over the data channel', await waitFor(A, () => !!(S.conn && S.conn.open)));
  check('B connects over the data channel', await waitFor(B, () => !!(S.conn && S.conn.open)));
  check('both reach the game screen',
        (await waitFor(A, () => document.querySelector('#scGame').classList.contains('on'))) &&
        (await waitFor(B, () => document.querySelector('#scGame').classList.contains('on'))));
  check('names crossed the connection',
        (await A.evaluate(() => S.theirName)) === 'Ben' && (await B.evaluate(() => S.theirName)) === 'Ann',
        { A: await A.evaluate(() => S.theirName), B: await B.evaluate(() => S.theirName) });
  check('exactly one side is the host',
        (await A.evaluate(() => S.isHost)) !== (await B.evaluate(() => S.isHost)));
  const turns = [await A.evaluate(() => S.myTurn), await B.evaluate(() => S.myTurn)];
  check('exactly one player has the turn', turns[0] !== turns[1], turns);
  check('each player has their own secret', await A.evaluate(() => !!S.mySecret) && await B.evaluate(() => !!S.mySecret));

  // ---------- a real question over the real channel ----------
  const ready = pg => pg.evaluate(() => S.phase === 'playing' && S.myTurn && !document.querySelector('#btnAsk').disabled);
  const askFrom = pg => pg.evaluate(() => {
    if (!S.myTurn || document.querySelector('#btnAsk').disabled) return false;
    document.querySelector('#qSelect').value = 'glasses';
    document.querySelector('#btnAsk').click();
    return true;
  });
  let asker = null, other = null;
  for (let i = 0; i < 60 && !asker; i++){
    if (await ready(A)) { asker = A; other = B; break; }
    if (await ready(B)) { asker = B; other = A; break; }
    await A.waitForTimeout(120);
  }
  check('the turn holder can ask', !!asker && await askFrom(asker));

  const both = async () =>
    (await A.evaluate(() => document.querySelector('#log').textContent)).includes('glasses') &&
    (await B.evaluate(() => document.querySelector('#log').textContent)).includes('glasses');
  check('the question crosses and the answer comes back', await waitFor(A, () => true) && await (async () => {
    for (let i = 0; i < 60; i++){ if (await both()) return true; await A.waitForTimeout(120); }
    return false;
  })());

  // the answer must be the truth about the answerer's own character
  const truthful = await (async () => {
    const secret = await other.evaluate(() => S.mySecret.glasses);
    const log = await asker.evaluate(() => document.querySelector('#log').textContent);
    return log.includes(secret ? 'YES' : 'NO');
  })();
  check('the answer matches the opponent\'s real character', truthful);

  // ---------- a final guess ends it on both sides ----------
  const guesser = await A.evaluate(() => S.myTurn) ? A : B;
  const victim  = guesser === A ? B : A;
  const wrongId = await victim.evaluate(() => (S.mySecret.id % 24) + 1);
  await guesser.evaluate(id => {
    document.querySelector('#btnGuess').click();
    document.querySelector('#board .tile[data-id="' + id + '"]').click();
  }, wrongId);
  check('a wrong guess loses for the guesser',
        await waitFor(guesser, () => document.querySelector('#endTitle').textContent.includes('lose')));
  check('and wins for the other player',
        await waitFor(victim, () => document.querySelector('#endTitle').textContent.includes('win')));

  check('no javascript errors', errs.length === 0, errs.slice(0, 5));

  console.log('\n' + (fail.length ? 'FAILED: ' + fail.join(' | ') : 'ALL PASS'));
  await browser.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
