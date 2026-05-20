# Catan Clone

A free, self-hostable multiplayer Catan clone for playing with friends — built because Colonist.io's bigger maps are paywalled.

## Tech stack

- **Backend:** Node.js, Express, Socket.io
- **Frontend:** Vanilla JavaScript, HTML, SVG (no framework)
- **Architecture:** Server-authoritative state, real-time sync via WebSockets

## Status

Work in progress. Built incrementally with Claude Code.

- [x] Phase 1: Socket.io server + basic frontend connection
- [ ] Phase 2: Hex board rendering with random tiles, ports, robber
- [ ] Phase 3: Vertex/edge graph for settlements and roads
- [ ] Phase 4: Full game logic (hot-seat)
- [ ] Phase 5: Multiplayer rooms
- [ ] Phase 6: Deploy

## Run locally

```bash
