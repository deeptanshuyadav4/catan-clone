# Catan Clone

Multiplayer Catan in the browser. Make a room, send the 4-letter code to your friends, and play. No accounts needed.

I started this because the bigger maps on colonist.io are behind a paywall and I wanted to play them with my friends. It's still a work in progress.

## What works

- Rooms for 2 to 4 players with a 4-letter join code
- A 37-hex board (the normal one has 19) with 9 ports, randomly generated each game, plus a "balanced" option that keeps 6s and 8s apart
- Opening placement in snake order, with starting resources from your second settlement
- Dice, resource production, and building roads, settlements and cities at the usual costs
- Trading with the bank at 4:1, or 3:1 / 2:1 if you have a port
- The robber: on a 7, anyone holding 8 or more cards discards half, then the player who rolled moves the robber and steals a random card from someone on that tile
- The host picks how many points it takes to win (3, 5, 8 or 10)

## Not done yet

- Trading between players
- Development cards
- Longest road and largest army
- Bigger maps, like the USA and world maps on colonist.io
- Bots for empty seats
- A live link so anyone can play without installing anything
- Rejoining after a refresh (right now refreshing the page loses your seat)

## Running it yourself

You need Node.js 18 or newer.

```bash
git clone https://github.com/deeptanshuyadav4/catan-clone.git
cd catan-clone
npm install
npm start
```

Then open http://localhost:3000. To try multiplayer on your own, open a second tab and join the room from there.

Friends on the same Wi-Fi can join at `http://<your computer's IP>:3000`. The server runs on port 3000 unless you set the `PORT` environment variable.

## How it works

The server holds the game state. When you click something, the browser sends an action like `place_road` over Socket.io. The server checks it against the rules, updates the board and sends the new state to everyone in the room. The rules live in `public/board-core.js`, which runs on both the server and the browser, so you see an error right away if a move isn't allowed.

- `server.js`: Express and Socket.io server, rooms, lobby, and handling every game action
- `public/board-core.js`: board generation and the game rules
- `public/render.js`: draws the board, pieces and dice as SVG
- `public/index.html`: page layout, styles and the client code

Built with Node.js, Express, Socket.io and plain JavaScript. No frontend framework.
