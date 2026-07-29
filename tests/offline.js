/* Does the game still open with no connection?
 *
 * The browser is put into offline mode for real — every network request
 * fails — and the page is reloaded. If the service worker has done its job
 * the game loads from cache and a whole one-device game can be played, which
 * is the aeroplane case.
 */
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8099/index.html';

const fail = [];
const check = (n, c, x) => { console.log((c?'  PASS  ':'  FAIL  ')+n+(x!==undefined?'  -> '+JSON.stringify(x):'')); if(!c) fail.push(n); };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  const p = await ctx.newPage();

  // ---- first visit, online: the worker should install ----
  await p.goto(URL);
  const registered = await p.evaluate(() =>
    navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false));
  check('the service worker installs', registered);
  check('the app is described for installing to a home screen',
        await p.evaluate(() => !!document.querySelector('link[rel=manifest]')));

  // give it a moment to finish caching the shell
  await p.waitForTimeout(1500);
  const cached = await p.evaluate(async () => {
    // don't hard-code the cache name; it changes with each release
    const names = await caches.keys();
    const out = [];
    for (const n of names){
      const keys = await (await caches.open(n)).keys();
      keys.forEach(r => out.push(new URL(r.url).pathname));
    }
    return out;
  });
  check('the page itself is cached', cached.some(u => /index\.html$|\/$/.test(u)), cached);
  check('the connection library is cached too', cached.some(u => /peerjs/.test(u)), cached);

  // ---- now pull the plug ----
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'load' });

  check('the game still loads with no connection',
        await p.evaluate(() => typeof CHARACTERS !== 'undefined' && CHARACTERS.length === 24));
  check('the artwork still renders offline',
        await p.evaluate(() => document.querySelectorAll('.facestrip svg').length > 0));
  check('the home screen is usable offline',
        await p.evaluate(() => document.querySelector('#scHome').classList.contains('on')));

  // ---- and a full game can be played on one device, still offline ----
  await p.click('#btnLocal');
  await p.fill('#p1Name', 'Ann');
  await p.fill('#p2Name', 'Ben');
  await p.click('#btnLocalStart');
  await p.click('#btnCoverReady');
  await p.waitForTimeout(200);
  check('a one-device game starts with no connection',
        await p.evaluate(() => S.phase === 'playing' && document.querySelectorAll('#board .tile').length === 24));

  const truth = await p.evaluate(() => !!L.players[1].secret.beard);
  await p.fill('#qInput', 'does your person have a beard');
  await p.click('#btnAsk');
  await p.waitForTimeout(250);
  check('questions are answered offline',
        (await p.evaluate(() => document.querySelector('#log').textContent)).includes(truth ? 'YES' : 'NO'),
        { expected: truth ? 'YES' : 'NO' });

  await p.click('#btnPass');
  await p.click('#btnCoverReady');
  await p.waitForTimeout(200);
  check('passing between players works offline',
        await p.evaluate(() => S.myName) === 'Ben');

  const rightId = await p.evaluate(() => L.players[0].secret.id);
  await p.click('#btnGuess');
  await p.evaluate(id => { document.querySelector('#board .tile[data-id="'+id+'"]').click();
                           document.querySelector('#btnGuessYes').click(); }, rightId);
  await p.waitForTimeout(300);
  check('a correct guess wins, offline',
        (await p.evaluate(() => document.querySelector('#endTitle').textContent)).includes('win'));

  console.log('\n' + (fail.length ? 'FAILED: ' + fail.join(' | ') : 'ALL PASS'));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
