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
- On your turn, pick a question and hit **Ask**. Their game answers it
  automatically and honestly, and the turn passes to them.
- Characters ruled out by the answer are flipped down for you. Turn off
  **Auto-flip** in the top bar if you'd rather do it by hand, and click any
  tile to flip it down or back up yourself.
- When you think you know, use **Final guess**. Right, you win. Wrong, you lose.

## Notes on how it works

- Neither player's secret character is ever sent to the other until the game
  ends. Questions are answered by the *answering* player's own browser from
  their own character, so nobody can peek and nobody has to be trusted.
- Room codes skip the letters `I`/`O` and the digits `0`/`1` so they're
  unambiguous when read out loud.
- The two browsers find each other through PeerJS's free public signalling
  server, which is used only to introduce them — the game traffic itself is
  direct. Very restrictive networks or VPNs can block peer-to-peer connections;
  if a connection can't be made the game says so rather than hanging.
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
