const { chromium } = require('playwright');
const fail=[];
const check=(n,c,x)=>{console.log((c?'  PASS  ':'  FAIL  ')+n+(x!==undefined?'  -> '+JSON.stringify(x):''));if(!c)fail.push(n);};

// A fake Peer that behaves like PeerJS: registers an id with a shared
// "server", loses it when the socket drops, and rejects connects to
// ids that aren't currently registered.
const FAKE = () => {
  window.__server = { ids: {} };
  window.__built = 0;      // how many Peer objects the app has constructed
  window.__gaps  = 0;      // how many times a live room lost its registration
  window.Peer = class {
    constructor(id, opts){
      window.__built++;
      this.id = id || 'rand-' + Math.random().toString(36).slice(2, 8);
      this.disconnected = false; this.destroyed = false; this._h = {};
      setTimeout(() => {
        if (this.destroyed) return;
        if (window.__server.ids[this.id]) { this._emit('error', {type:'unavailable-id'}); return; }
        window.__server.ids[this.id] = this;
        this._emit('open', this.id);
      }, 10);
    }
    on(ev, fn){ (this._h[ev] = this._h[ev] || []).push(fn); }
    _emit(ev, a){ (this._h[ev] || []).forEach(f => f(a)); }
    // simulate the browser suspending the tab: socket closes, id unregisters
    __drop(){ delete window.__server.ids[this.id]; this.disconnected = true; this._emit('disconnected'); }
    reconnect(){
      if (this.destroyed) throw new Error('destroyed');
      setTimeout(() => {
        if (window.__server.ids[this.id]) { this._emit('error', {type:'unavailable-id'}); return; }
        window.__server.ids[this.id] = this; this.disconnected = false; this._emit('open', this.id);
      }, 300);
    }
    connect(target){
      const c = { peer: target, open:false, _h:{}, on(e,f){(this._h[e]=this._h[e]||[]).push(f);},
                  _emit(e,a){(this._h[e]||[]).forEach(f=>f(a));}, send(){}, close(){} };
      setTimeout(() => {
        if (!window.__server.ids[target]) { this._emit('error', {type:'peer-unavailable'}); return; }
        c.open = true; c._emit('open');
      }, 10);
      return c;
    }
    destroy(){
      this.destroyed = true;
      if (window.__server.ids[this.id]) window.__gaps++;
      delete window.__server.ids[this.id];
      this._emit('close');            // real PeerJS emits close on destroy
    }
  };
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({viewport:{width:1100,height:900}});
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('http://127.0.0.1:8099/index.html');
  await p.evaluate(FAKE);            // replace real PeerJS once the page has loaded
  await p.click('#btnCreate');
  await p.waitForTimeout(700);   // seek finds nobody, then we hold the room

  const code = await p.evaluate(() => S.code);
  check('room created and registered', await p.evaluate(() => S.roomLive && !!window.__server.ids['guesswho-v1-'+S.code]), code);
  check('lobby shows the code', (await p.evaluate(()=>document.querySelector('#lobbyCode').textContent)) === code);

  // --- the actual reported bug: host switches apps, socket drops ---
  await p.evaluate(() => S.peer.__drop());
  await p.waitForTimeout(60);   // mid-outage, before the reconnect lands
  check('host is told the room went down',
        (await p.evaluate(()=>document.querySelector('#lobbyStatus').textContent)).includes('Reconnecting'));
  check('status dot turns red', await p.evaluate(()=>document.querySelector('#lobbyDot').classList.contains('down')));

  await p.waitForTimeout(600);
  check('room re-registers itself automatically', await p.evaluate(() => !!window.__server.ids['guesswho-v1-'+S.code]));
  check('code did NOT change while re-registering', (await p.evaluate(()=>S.code)) === code);
  check('lobby says waiting again', (await p.evaluate(()=>document.querySelector('#lobbyStatus').textContent)).includes('Waiting'));

  // --- harder case: peer destroyed entirely, recovered on tab focus ---
  await p.evaluate(() => S.peer.destroy());
  await p.waitForTimeout(50);
  check('destroyed peer means code is gone', await p.evaluate(() => !window.__server.ids['guesswho-v1-'+S.code]));
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForTimeout(300);
  check('returning to the tab restores the room', await p.evaluate(() => !!window.__server.ids['guesswho-v1-'+S.code]));
  check('still the same code', (await p.evaluate(()=>S.code)) === code);

  // --- recovering must not start an endless rebuild loop ---
  // (the reconnect path is not enough: force the re-register path, which is
  //  what runs when the peer is gone rather than merely disconnected)
  const p2 = await ctx.newPage();
  await p2.goto('http://127.0.0.1:8099/index.html');
  await p2.evaluate(FAKE);
  await p2.click('#btnCreate');
  await p2.waitForTimeout(700);
  const code2 = await p2.evaluate(() => S.code);
  check('sanity: a room costs one seek plus one hold',
        (await p2.evaluate(() => window.__built)) === 2, await p2.evaluate(() => window.__built));

  await p2.evaluate(() => S.peer.destroy());                       // peer gone
  await p2.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p2.waitForTimeout(1200);
  const built1 = await p2.evaluate(() => window.__built);
  const gaps1  = await p2.evaluate(() => window.__gaps);
  check('room came back after the peer was destroyed',
        await p2.evaluate(() => !!window.__server.ids['guesswho-v1-'+S.code]));

  await p2.waitForTimeout(7000);                                   // then sit idle
  const built2 = await p2.evaluate(() => window.__built);
  const gaps2  = await p2.evaluate(() => window.__gaps);
  check('recovered room is not rebuilt over and over', built2 === built1,
        { afterRecovery: built1, sevenSecondsLater: built2 });
  check('recovered room is never torn down again while idle', gaps2 === gaps1,
        { gapsAfterRecovery: gaps1, gapsLater: gaps2 });
  check('room still registered after sitting idle',
        await p2.evaluate(() => !!window.__server.ids['guesswho-v1-'+S.code]));
  check('code survived the interruption', (await p2.evaluate(() => S.code)) === code2);
  check('lobby reports the room as live',
        await p2.evaluate(() => document.querySelector('#lobbyDot').classList.contains('up')));

  const late = await ctx.newPage();
  await late.goto('http://127.0.0.1:8099/index.html');
  await late.evaluate(FAKE);
  await late.evaluate(c => { window.__server.ids['guesswho-v1-'+c] = {}; }, code2);
  await late.fill('#codeInput', code2);
  await late.click('#btnJoin');
  await late.waitForTimeout(400);
  check('late joiner connects to the recovered room', await late.evaluate(() => !!(S.conn && S.conn.open)));

  console.log('\n' + (fail.length ? 'FAILED: ' + fail.join(' | ') : 'ALL PASS'));
  await b.close();
  process.exit(fail.length?1:0);
})();
