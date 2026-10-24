# Catan Clone

Multiplayer Catan in the browser. Make a room, send the 4-letter code to your friends, and play. No accounts needed.

**Play it here: https://catan-clone-production.up.railway.app**

It runs on a free server that sleeps when nobody is playing, so the first load can take a few seconds.

I started this because the bigger maps on colonist.io are behind a paywall and I wanted to play them with my friends. It's still a work in progress.

## Maps

The host picks the map in the lobby. Every game shuffles the tiles, numbers and ports.

| Map | Size | Tiles |
|---|---|---|
| Classic | Small | 19, the normal board |
| Grand Isle | Medium | 37 |
| Twin Isles | Medium | 38, two islands |
| Lakeland | Big | 84, with three lakes |
| World | Huge | 110, eight continents |
| USA | Huge | 152 |

On the big maps you can zoom with the mouse wheel (or the + and − buttons) and drag to move around.

## What works

- Rooms for 2 to 4 players with a 4-letter join code, or an invite link (`?room=ABCD`) that joins in one tap
- Refreshing or losing connection puts you back in your seat. If you closed the tab, opening the link again lets you take your seat back
- Six maps, plus a "balanced" option that keeps 6s and 8s apart
- Opening placement in snake order, with starting resources from your second settlement
- Dice, resource production, and building roads, settlements and cities at the usual costs, with the usual
  15 roads, 5 settlements and 4 cities each
- A bank with a limited supply of each card (bigger maps get a bigger bank)
- Trading with the bank at 4:1, or 3:1 / 2:1 if you have a port
- The robber: on a 7, anyone holding 8 or more cards discards half, then the player who rolled moves the robber and steals a random card from someone on that tile
- The host picks how many points it takes to win (3, 5, 8 or 10)
- Game log, chat, your hand of cards, a turn timer, and glowing spots showing where you can build
- An end screen with the winner, game time, and stats for points, dice rolls and cards collected

## Not done yet

- Trading between players
- Development cards
- Longest road and largest army points (road length is shown, but doesn't score yet)
- Bots for empty seats

## Running it yourself

You need Node.js 22 or newer.

```bash
git clone https://github.com/deeptanshuyadav4/catan-clone.git
cd catan-clone
npm install
npm start
```

Then open http://localhost:3000. To try multiplayer on your own, open a second tab and join the room from there.

Friends on the same Wi-Fi can join at `http://<your computer's IP>:3000`. The server runs on port 3000 unless you set the `PORT` environment variable.

### Admin page

There's a control panel at `/admin` showing who's online, every room and game, and buttons to close a room, remove a player, send an announcement banner to everyone, or pause new games before an update. It's off unless you set a password:

```bash
ADMIN_PASSWORD=pick-something-long npm start
```

(On Windows PowerShell: `$env:ADMIN_PASSWORD="pick-something-long"; npm start`.) Everything on it resets when the server restarts.

## How it works

The server holds the game state. When you click something, the browser sends an action like `place_road` over Socket.io. The server checks it against the rules, updates the board and sends the new state to everyone in the room. The rules live in `public/board-core.js`, which runs on both the server and the browser, so you see an error right away if a move isn't allowed.

- `server.js`: Express and Socket.io server, rooms, lobby, and handling every game action
- `admin.js` and `admin/index.html`: the password-protected admin page
- `public/board-core.js`: the maps, board generation and the game rules
- `public/render.js`: draws the board, ports and pieces as SVG
- `public/index.html`: page layout, styles and the client code

Maps are drawn as text in `board-core.js`, one character per tile (`o` for land, `d` for a desert), so adding a new map is mostly drawing its outline.

Built with Node.js, Express, Socket.io and plain JavaScript. No frontend framework.
