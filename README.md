# Guess Who — online

The classic guessing game, playable with a friend over the internet. One player
creates a room, sends the code (or the link), and both boards appear.

There is no server and no database: the two browsers talk to each other
directly over WebRTC, so nothing about your game is stored anywhere.

## Putting it online

The whole game is static files, so GitHub Pages will host it for free:

1. On GitHub go to **Settings → Pages**.
2. Under **Source** pick **Deploy from a branch**.
3. Choose the branch holding this code and the `/ (root)` folder, then save.
   Right now that's `claude/guess-who-multiplayer-h4gyqo`, since it's the only
   branch in the repository — if you merge it into `main` first, pick `main`.
4. After a minute your game is live at `https://<your-username>.github.io/Guess-who/`.

That's the link you send people.

To try it locally instead, run any static file server from this folder — for
example `npx http-server` — and open the address it prints. Opening
`index.html` straight off disk works too.

## How to play

- One player clicks **Create a room** and gets a four-character code.
- The other types that code on the home screen and hits **Join**.
  (Sharing the room link skips this — it fills the code in for them.)
- You each get the same 24 characters and are secretly dealt one of them.
  Your character is shown in the side panel; your opponent's is what you're hunting.
- On your turn, **type a question in your own words** — "do they have a
  beard?", "are they ginger?", "is your person wearing a hat?" — and the game
  shows what it understood before you send it. Their device answers from their
  own character, so the answer is always honest.
- **You** flip the cards down. Working out who is ruled out is the game, so
  nothing moves on its own; click any tile to flip it down or back up.
- When you think you know, use **Final guess**. Right, you win. Wrong, you lose.

## Connect manually — when codes won't work

Room codes rely on a free public matchmaking server to introduce the two
browsers. If that server is unreachable or fails to pair you, no code will
ever work, and there is nothing to fix from this side.

**Connect manually** goes around it. There is no server in the path at all —
the two of you carry the handshake yourselves, in four steps that both
players see numbered the same way:

1. **You** tap **Connect manually → Make an invite**, then **Copy message**,
   and send it however you like.
2. **They** open the game, tap **Connect manually**, and paste that whole
   message in. They get a block back.
3. **They** send that block to you.
4. **You** paste it in. The game starts.

What gets copied is a complete message — a link to the game, what to tap, and
the block itself — so whoever receives it needs no explaining. Paste the whole
thing at either end; surrounding words are fine, and there is one box that
works out which half you were sent.

Worth knowing: this still needs a working WebRTC route between the two of you
(see mobile data, below). What it removes is the matchmaking server, not the
networking.

## Turning up at a room

Neither player owns the room. You both walk up to the same code: whoever gets
there first holds it open and waits, and the second one to arrive connects.

That matters because a room lives inside a browser tab, and a suspended tab
runs no code at all. Switching to another app to send someone the code is
enough to freeze the page, which used to take the room down at exactly the
moment your friend was trying to use it. Now if you get pulled away, your
friend simply takes over holding the room, and when you come back your page
notices someone else has it and connects to them instead.

So the code can be shared whenever and used whenever. You don't have to be
looking at the page at the same moment.

If it still won't connect, the footer says whether the matchmaking server is
reachable from that device at all, which separates a blocked network from
anything else. The lobby's dot is green while the room is genuinely
registered.

## Notes on how it works

- Neither player's secret character is ever sent to the other until the game
  ends. Questions are answered by the *answering* player's own browser from
  their own character, so nobody can peek and nobody has to be trusted. Typing
  questions freely does not change that: the words are matched to one of the
  known questions, and that question is what the other device answers.
- If a question can't be understood it is refused rather than guessed at — a
  confidently wrong answer would be worse than asking again.
- Room codes skip the letters `I`/`O` and the digits `0`/`1` so they're
  unambiguous when read out loud.
- The two browsers find each other through PeerJS's free public signalling
  server, which is used only to introduce them — the game traffic itself is
  direct. If a connection can't be made the game says so rather than hanging.
- Mobile data works. Carriers put phones behind carrier-grade NAT, which often
  rules out a direct browser-to-browser path, so the game also lists TURN relay
  servers and falls back to relaying through one. A relayed game is slower to
  set up but plays identically — a turn is a few bytes, not a video call. Those
  relays are free shared services, so they are the most likely thing to be
  flaky; the game is only using them when no direct route exists.
- `vendor/peerjs.min.js` is checked in deliberately, so the site has no
  external dependencies at runtime.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The entire game: characters, artwork, rules, networking, UI |
| `vendor/peerjs.min.js` | PeerJS 1.5.4, the WebRTC connection library |

The 24 characters are defined as plain attribute data near the top of the
script in `index.html`. Both the artwork (drawn as SVG at runtime — there are
no image files) and the question list are generated from those attributes, so
adding a character or a question means editing the data, not the drawing code.
