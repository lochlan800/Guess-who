const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8099/index.html';

const fail = [];
const check = (n, c, x) => { console.log((c?'  PASS  ':'  FAIL  ')+n+(x!==undefined?'  -> '+JSON.stringify(x):'')); if(!c) fail.push(n); };

/* A fake signalling network shared by every tab in the browser:
   localStorage is the peer-id registry, BroadcastChannel carries the traffic.
   That makes this a real multi-tab test of the rendezvous, not a stub. */
const FAKE = () => {
  const REG = 'fake_registry';
  // The server tracks who registered an id, so tearing down a peer whose
  // registration already lapsed must not evict whoever holds it now.
  const reg = {
    all:  () => JSON.parse(localStorage.getItem(REG) || '{}'),
    has:  id => !!reg.all()[id],
    owner:id => reg.all()[id],
    add:  (id, tok) => { const a = reg.all(); a[id] = tok; localStorage.setItem(REG, JSON.stringify(a)); },
    del:  (id, tok) => { const a = reg.all(); if (a[id] === tok) { delete a[id]; localStorage.setItem(REG, JSON.stringify(a)); } }
  };
  window.__reg = reg;
  window.__built = 0;

  const mkConn = (connId, peerId, ctrl) => {
    const ch = new BroadcastChannel('fake-conn-' + connId);
    const c = {
      peer: peerId, open: false, _h: {},
      on(e, f){ (this._h[e] = this._h[e] || []).push(f); },
      _emit(e, a){ (this._h[e] || []).forEach(f => f(a)); },
      send(d){ ch.postMessage({ from: connId, d }); },
      close(){ try { ch.close(); } catch(e){} this._emit('close'); }
    };
    ch.onmessage = e => { if (e.data && e.data.tag !== connId) c._emit('data', e.data.d); };
    // tag our own outgoing messages so we don't hear ourselves
    const send = c.send.bind(c);
    c.send = d => ch.postMessage({ tag: myTag, d });
    const myTag = Math.random().toString(36).slice(2);
    ch.onmessage = e => { if (e.data && e.data.tag !== myTag) c._emit('data', e.data.d); };
    return c;
  };

  window.Peer = class {
    constructor(id){
      window.__built++;
      this.id = id || 'rand-' + Math.random().toString(36).slice(2, 8);
      this.disconnected = false; this.destroyed = false; this._h = {}; this._pending = {};
      this._tok = Math.random().toString(36).slice(2);
      this._ctrl = new BroadcastChannel('fake-ctrl');
      this._ctrl.onmessage = e => {
        const m = e.data;
        if (this.destroyed) return;
        if (m.type === 'connect' && m.to === this.id){
          const c = mkConn(m.connId, m.from);
          this._emit('connection', c);
          this._ctrl.postMessage({ type: 'accept', connId: m.connId, to: m.from });
          setTimeout(() => { c.open = true; c._emit('open'); }, 5);
        }
        if (m.type === 'accept' && this._pending[m.connId]){
          const c = this._pending[m.connId];
          setTimeout(() => { c.open = true; c._emit('open'); }, 5);
        }
      };
      setTimeout(() => {
        if (this.destroyed) return;
        if (reg.has(this.id)) { this._emit('error', { type: 'unavailable-id' }); return; }
        reg.add(this.id, this._tok); this._emit('open', this.id);
      }, 15);
    }
    on(ev, fn){ (this._h[ev] = this._h[ev] || []).push(fn); }
    _emit(ev, a){ (this._h[ev] || []).forEach(f => f(a)); }

    connect(target){
      const connId = Math.random().toString(36).slice(2);
      const c = mkConn(connId, target);
      this._pending[connId] = c;
      setTimeout(() => {
        if (!reg.has(target)) { this._emit('error', { type: 'peer-unavailable' }); return; }
        this._ctrl.postMessage({ type: 'connect', to: target, from: this.id, connId });
      }, 15);
      return c;
    }
    reconnect(){
      if (this.destroyed) throw new Error('destroyed');
      setTimeout(() => {
        if (reg.has(this.id)) { this._emit('error', { type: 'unavailable-id' }); return; }
        reg.add(this.id, this._tok); this.disconnected = false; this._emit('open', this.id);
      }, 15);
    }
    destroy(){
      this.destroyed = true; reg.del(this.id, this._tok);
      try { this._ctrl.close(); } catch(e){}
      this._emit('close');
    }
    /* the tab froze: registration lapses server-side and nothing runs here */
    __freeze(){ reg.del(this.id, this._tok); this.__frozen = true; }
    /* the tab woke: the queued socket close is finally delivered */
    __thaw(){ this.disconnected = true; this._emit('disconnected'); }
  };
};

const openTab = async (ctx, url) => {
  const p = await ctx.newPage();
  await p.route('**/vendor/peerjs.min.js', r => r.fulfill({
    contentType: 'application/javascript', body: '(' + FAKE.toString() + ')();'
  }));
  p.on('pageerror', e => console.log('  PAGEERROR', e.message));
  await p.goto(url);
  return p;
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });

  // ---------- 1. first to arrive holds the room ----------
  const A = await openTab(ctx, URL + '?room=ABCD');
  await A.waitForTimeout(700);
  check('first arrival holds the room', await A.evaluate(() => S.isHost && S.roomLive));
  check('first arrival waits rather than erroring',
        await A.evaluate(() => document.querySelector('#scLobby').classList.contains('on')));
  check('room is registered', await A.evaluate(() => window.__reg.has('guesswho-v1-ABCD')));

  // ---------- 2. second arrival connects ----------
  const B = await openTab(ctx, URL + '?room=ABCD');
  await B.waitForTimeout(900);
  check('second arrival connects', await B.evaluate(() => !!(S.conn && S.conn.open)));
  check('holder sees the connection', await A.evaluate(() => !!(S.conn && S.conn.open)));
  check('both reach the game screen',
        (await A.evaluate(() => document.querySelector('#scGame').classList.contains('on'))) &&
        (await B.evaluate(() => document.querySelector('#scGame').classList.contains('on'))));
  const turns = [await A.evaluate(() => S.myTurn), await B.evaluate(() => S.myTurn)];
  check('exactly one player has the turn', turns[0] !== turns[1], turns);
  check('exactly one side is the host',
        (await A.evaluate(() => S.isHost)) !== (await B.evaluate(() => S.isHost)));

  // a real move must cross the wire
  // ask from whichever tab currently holds the turn, then wait for the answer
  const askFrom = async pg => pg.evaluate(() => {
    if (!S.myTurn || document.querySelector('#btnAsk').disabled) return false;
    document.querySelector('#qSelect').value = 'glasses';
    document.querySelector('#btnAsk').click();
    return true;
  });
  // wait until a side is actually ready to ask before poking it
  const ready = pg => pg.evaluate(() => S.phase === 'playing' && S.myTurn && !document.querySelector('#btnAsk').disabled);
  let askedOk = false;
  for (let i = 0; i < 40 && !askedOk; i++){
    if (await ready(A)) { askedOk = await askFrom(A); break; }
    if (await ready(B)) { askedOk = await askFrom(B); break; }
    await A.waitForTimeout(100);
  }
  check('the tab holding the turn can ask', askedOk);

  let crossed = false;
  for (let i = 0; i < 30 && !crossed; i++){
    crossed = (await A.evaluate(() => document.querySelector('#log').textContent)).includes('glasses')
           && (await B.evaluate(() => document.querySelector('#log').textContent)).includes('glasses');
    if (!crossed) await A.waitForTimeout(100);
  }
  check('the question reaches the other tab and the answer comes back', crossed,
        { A: (await A.evaluate(() => document.querySelector('#log').textContent)).slice(-90),
          B: (await B.evaluate(() => document.querySelector('#log').textContent)).slice(-90) });
  await A.close(); await B.close();

  // ---------- 3. THE REAL SCENARIO ----------
  // You make a room, switch to your messaging app (tab freezes, room lapses),
  // your friend opens the link while you're still away, then you come back.
  await ctx.clearCookies();
  const C = await openTab(ctx, URL);
  await C.evaluate(() => localStorage.setItem('fake_registry', '{}'));
  await C.evaluate(() => { S.myName = 'Host'; enterRoom('WXYZ'); });
  await C.waitForTimeout(700);
  check('you hold the room before switching away', await C.evaluate(() => S.isHost && S.roomLive));

  await C.evaluate(() => S.peer.__freeze());          // you switch to Messages
  check('room lapses while your tab is frozen', await C.evaluate(() => !window.__reg.has('guesswho-v1-WXYZ')));

  const D = await openTab(ctx, URL + '?room=WXYZ');   // friend opens the link now
  await D.waitForTimeout(11000);                      // seek fails, then holds it
  check('friend holds the room instead of failing', await D.evaluate(() => S.isHost && S.roomLive),
        await D.evaluate(() => document.querySelector('#lobbyStatus').textContent));
  check('friend is still waiting, not sent home',
        await D.evaluate(() => document.querySelector('#scLobby').classList.contains('on')));

  // you come back to the tab
  await C.evaluate(() => { S.peer.__thaw(); document.dispatchEvent(new Event('visibilitychange')); });
  await C.waitForTimeout(2500);
  check('coming back connects you to your friend', await C.evaluate(() => !!(S.conn && S.conn.open)),
        await C.evaluate(() => document.querySelector('#lobbyStatus').textContent));
  check('friend is connected too', await D.evaluate(() => !!(S.conn && S.conn.open)));
  check('the game starts for both',
        (await C.evaluate(() => document.querySelector('#scGame').classList.contains('on'))) &&
        (await D.evaluate(() => document.querySelector('#scGame').classList.contains('on'))));
  check('still exactly one host after the swap',
        (await C.evaluate(() => S.isHost)) !== (await D.evaluate(() => S.isHost)));
  const t2 = [await C.evaluate(() => S.myTurn), await D.evaluate(() => S.myTurn)];
  check('exactly one player has the turn after the swap', t2[0] !== t2[1], t2);

  console.log('\n' + (fail.length ? 'FAILED: ' + fail.join(' | ') : 'ALL PASS'));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
