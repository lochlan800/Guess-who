# Tests

Browser tests, driven by Playwright against a local copy of the game.

```sh
npx http-server -p 8099 -s      # serve the repo root
node tests/test.js              # gameplay
node tests/recon.js             # staying connected
node tests/rendezvous.js        # two tabs meeting in a room
node tests/manual.js            # manual connect, real WebRTC
```

They need Playwright available (`NODE_PATH` may have to point at a global
install). Each script exits non-zero on failure and prints one line per check.

| Script | Covers |
| --- | --- |
| `test.js` | Rules and UI: the board, questions and answers, auto-flip, guessing, rematch, chat. Two pages with the transport stubbed, so the game logic is exercised without a network. |
| `recon.js` | Surviving interruptions: re-registering after the connection drops, keeping the same code, and never rebuilding a room that is already healthy. |
| `rendezvous.js` | Two real tabs meeting over a shared fake signalling network, including the case that matters most — one player's tab freezes, the other takes over the room, and the first reconnects to them. |
| `manual.js` | Manual connect with **nothing faked**: two tabs complete a real WebRTC handshake by passing the invite and reply blobs between them, then play over the resulting data channel. Runs with no external network, because local candidates are enough for two tabs on one machine. |

The fake network in `rendezvous.js` uses `localStorage` as the peer registry
and `BroadcastChannel` for traffic, so both tabs really do talk to each other.
It models the parts of PeerJS that the game depends on: an id can only be held
by one peer, connecting to an unheld id fails with `peer-unavailable`, and
tearing down a peer whose registration already lapsed must not evict whoever
holds it now.

A note on why the fakes exist: the real signalling server is not reachable
from the sandbox this was written in, so none of these tests prove the game
works against the live network. They pin down the logic and the failure
handling, which is where the bugs were.
