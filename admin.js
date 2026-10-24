'use strict';
// admin.js — the owner's dashboard at /admin.
// Turned on by setting the ADMIN_PASSWORD environment variable. Everything here lives
// in memory, so it starts fresh whenever the server restarts.
const crypto = require('crypto');
const path   = require('path');
const express = require('express');

const SESSION_MS    = 12 * 60 * 60 * 1000;  // stay logged in for 12 hours
const LOGIN_WINDOW  = 10 * 60 * 1000;       // at most 5 wrong passwords per 10 minutes per IP
const LOGIN_TRIES   = 5;

function setupAdmin({ app, io, rooms, info, Board, helpers }) {
  const password = process.env.ADMIN_PASSWORD || '';
  const sessions = new Map();   // session id -> expiry time
  const attempts = new Map();   // ip -> { count, resetAt }

  // ── Login helpers ─────────────────────────────────────────────────────────
  const hash = s => crypto.createHash('sha256').update(String(s)).digest();
  const passwordMatches = given => password && crypto.timingSafeEqual(hash(given), hash(password));

  function sessionFrom(req) {
    const cookie = req.headers.cookie || '';
    const match  = cookie.match(/(?:^|;\s*)admin_session=([a-f0-9]{64})/);
    if (!match) return null;
    const expires = sessions.get(match[1]);
    if (!expires || expires < Date.now()) { sessions.delete(match[1]); return null; }
    return match[1];
  }

  function cookieFor(req, value, maxAge) {
    const secure = req.secure ? '; Secure' : '';
    return `admin_session=${value}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${maxAge}${secure}`;
  }

  function requireAdmin(req, res, next) {
    if (!password)        return res.status(503).json({ error: 'Admin is off. Set the ADMIN_PASSWORD variable on the server.' });
    if (!sessionFrom(req)) return res.status(401).json({ error: 'Please log in' });
    next();
  }

  // ── Routes ────────────────────────────────────────────────────────────────
  const router = express.Router();
  router.use(express.json({ limit: '10kb' }));

  router.get('/', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));

  router.get('/api/status', (req, res) => {
    res.json({ enabled: !!password, loggedIn: !!(password && sessionFrom(req)) });
  });

  router.post('/api/login', (req, res) => {
    if (!password) return res.status(503).json({ error: 'Admin is off. Set the ADMIN_PASSWORD variable on the server.' });
    const ip  = req.ip;
    const now = Date.now();
    const a   = attempts.get(ip) || { count: 0, resetAt: now + LOGIN_WINDOW };
    if (a.resetAt < now) { a.count = 0; a.resetAt = now + LOGIN_WINDOW; }
    if (a.count >= LOGIN_TRIES) {
      return res.status(429).json({ error: 'Too many wrong passwords. Try again in a few minutes.' });
    }
    if (!passwordMatches((req.body || {}).password || '')) {
      a.count++;
      attempts.set(ip, a);
      return res.status(401).json({ error: 'Wrong password' });
    }
    attempts.delete(ip);
    const id = crypto.randomBytes(32).toString('hex');
    sessions.set(id, now + SESSION_MS);
    res.setHeader('Set-Cookie', cookieFor(req, id, SESSION_MS / 1000));
    res.json({ ok: true });
  });

  router.post('/api/logout', (req, res) => {
    const id = sessionFrom(req);
    if (id) sessions.delete(id);
    res.setHeader('Set-Cookie', cookieFor(req, '', 0));
    res.json({ ok: true });
  });

  // Everything the dashboard shows
  router.get('/api/overview', requireAdmin, (req, res) => {
    const now = Date.now();
    const roomList = Object.entries(rooms).map(([code, room]) => {
      const board  = room.board;
      const status = !room.started ? 'lobby' : board.gameState.gameEnded ? 'finished' : 'playing';
      const players = Object.values(room.players).map(p => ({
        color:     p.color,
        connected: p.connected,
        vp:        board ? Board.calculateVP(board, p.color) : 0,
        cards:     board ? Board.handSize(board, p.color) : 0,
      }));
      const stats = board && board.gameState.stats;
      return {
        code,
        status,
        map:       Board.MAPS[room.mapId] ? Board.MAPS[room.mapId].name : (room.started ? '?' : '-'),
        winTarget: room.winTarget,
        host:      room.hostColor,
        players,
        turn:      status === 'playing' ? Board.getCurrentPlayer(board) : null,
        winner:    status === 'finished' ? board.gameState.winner : null,
        turns:     stats ? stats.turns : 0,
        createdAt: room.createdAt,
        startedAt: room.startedAt || null,
      };
    }).sort((a, b) => b.createdAt - a.createdAt);

    const seated = roomList.reduce((n, r) => n + r.players.filter(p => p.connected).length, 0);
    res.json({
      now,
      uptimeMs:    now - info.startedAt,
      memoryMb:    Math.round(process.memoryUsage().rss / 1024 / 1024),
      online:      io.engine.clientsCount,
      seated,
      peakOnline:  info.peakOnline,
      counters:    info.counters,
      maintenance: info.maintenance,
      announcement: info.announcement,
      rooms:       roomList,
      activity:    info.activity.slice(0, 60),
    });
  });

  router.post('/api/rooms/:code/close', requireAdmin, (req, res) => {
    const code = String(req.params.code).toUpperCase();
    if (!rooms[code]) return res.status(404).json({ error: 'No such room' });
    helpers.closeRoom(code, 'This room was closed by the admin.');
    info.track(`Admin closed room ${code}`);
    res.json({ ok: true });
  });

  router.post('/api/rooms/:code/kick', requireAdmin, (req, res) => {
    const code  = String(req.params.code).toUpperCase();
    const color = (req.body || {}).color;
    if (!rooms[code]) return res.status(404).json({ error: 'No such room' });
    if (!helpers.kickPlayer(code, color)) return res.status(404).json({ error: 'No such player' });
    info.track(`Admin removed ${color} from room ${code}`);
    res.json({ ok: true });
  });

  // Banner for everyone on the site. Empty text clears it.
  router.post('/api/announce', requireAdmin, (req, res) => {
    const text = String((req.body || {}).text || '').trim().slice(0, 200);
    info.announcement = text || null;
    io.emit('announcement', { text: info.announcement });
    info.track(text ? `Announcement: "${text}"` : 'Announcement cleared');
    res.json({ ok: true });
  });

  // Pause new games (games already running carry on)
  router.post('/api/maintenance', requireAdmin, (req, res) => {
    info.maintenance = !!(req.body || {}).on;
    info.track(info.maintenance ? 'Maintenance mode ON (new games paused)' : 'Maintenance mode OFF');
    res.json({ ok: true, maintenance: info.maintenance });
  });

  app.use('/admin', router);
}

module.exports = { setupAdmin };
