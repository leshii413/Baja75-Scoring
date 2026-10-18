// Baja75 live timing relay (Cloudflare Worker + one Durable Object).
//
//   POST /api/push                 the BeamMP server plugin, every second by default (Authorization: Bearer <PUSH_KEY>)
//   GET  /api/races                live and recent races
//   GET  /api/races/<id>[?trails=1] one race (trails = every car's path, which draws the route)
//   GET  /api/races/<id>/ws         WebSocket: a snapshot, then every update as it arrives
//   GET  /embed[/<id>]              the live results page to put in an <iframe> (no id = follow the newest live race)
//   GET  /api/health
//
// Everything lives in one Durable Object ("hub"): small enough for a racing series, and viewers' WebSocket messages
// are free on Cloudflare (only incoming messages count).

import { DurableObject } from 'cloudflare:workers';
import { embedHtml } from './embed';
import { cleanPayload, emptyHub, housekeeping, ingest, LIMITS, listRaces, raceView, type Hub } from './state';

export interface Env { HUB: DurableObjectNamespace<LiveHub>; PUSH_KEY?: string }

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra } });

function sameKey(a: string, b: string): boolean {
  // constant-time compare
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const hub = () => env.HUB.get(env.HUB.idFromName('hub'));

    if (path === '/api/health') return json({ ok: true, pushKeySet: !!env.PUSH_KEY });

    if (path === '/api/push') {
      if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
      if (!env.PUSH_KEY) return json({ error: 'PUSH_KEY is not set on the relay (wrangler secret put PUSH_KEY)' }, 503);
      const auth = req.headers.get('Authorization') ?? '';
      if (!sameKey(auth.replace(/^Bearer\s+/i, ''), env.PUSH_KEY)) return json({ error: 'wrong key' }, 401);
      const len = Number(req.headers.get('Content-Length') ?? '0');
      if (len > 512 * 1024) return json({ error: 'too large' }, 413);
      const text = await req.text();
      if (text.length > 512 * 1024) return json({ error: 'too large' }, 413);
      return hub().fetch('https://hub/push', { method: 'POST', body: text });
    }

    if (path === '/api/races') return hub().fetch('https://hub/races');
    let m = /^\/api\/races\/([\w-]{1,120})\/ws$/.exec(path);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'WebSocket only' }, 426);
      return hub().fetch(new Request(`https://hub/ws/${m[1]}`, req));
    }
    m = /^\/api\/races\/([\w-]{1,120})$/.exec(path);
    if (m) return hub().fetch(`https://hub/race/${m[1]}${url.searchParams.get('trails') === '1' ? '?trails=1' : ''}`);

    if (path === '/' || path === '/embed' || /^\/embed\/[\w-]{1,120}$/.test(path)) {
      const id = path.startsWith('/embed/') ? path.slice(7) : '';
      return new Response(embedHtml(id), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': "frame-ancestors *" } });
    }
    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;

const PERSIST_EVERY_MS = 30_000;

export class LiveHub extends DurableObject<Env> {
  private hub: Hub | null = null;
  private lastPersist = 0;
  private dirty = new Set<string>();
  /** trail points already stored, per "race|driver" */
  private persisted: Record<string, number> = {};

  private async load(): Promise<Hub> {
    if (this.hub) return this.hub;
    const meta = await this.ctx.storage.get<Omit<Hub, 'trails'>>('hub');
    const hub: Hub = meta ? { ...meta, trails: {} } : emptyHub();
    // trails: "t|<race>|<chunk>|<driver>" = 1,000 points each, so no stored item gets near the size limit
    const stored = await this.ctx.storage.list<[number, number][]>({ prefix: 't|' });
    const chunks: Record<string, [number, [number, number][]][]> = {};
    for (const [k, pts] of stored) {
      const m = /^t\|([^|]+)\|(\d+)\|(.+)$/.exec(k);
      if (!m || !hub.races[m[1]]) continue;
      (chunks[`${m[1]}|${m[3]}`] ??= []).push([Number(m[2]), pts]);
    }
    for (const [rk, list] of Object.entries(chunks)) {
      const i = rk.indexOf('|'), raceId = rk.slice(0, i), driverKey = rk.slice(i + 1);
      const pts = list.sort((x, y) => x[0] - y[0]).flatMap((x) => x[1]);
      (hub.trails[raceId] ??= {})[driverKey] = pts;
      this.persisted[rk] = pts.length;
    }
    this.hub = hub;
    return hub;
  }

  /** Writes what changed: the race list, and per driver only the trail chunks that grew (rows written are counted daily). */
  private async persist(force = false) {
    const hub = this.hub; if (!hub) return;
    const now = Date.now();
    if (!force && now - this.lastPersist < PERSIST_EVERY_MS) return;
    this.lastPersist = now;
    await this.ctx.storage.put('hub', { races: hub.races, resetBase: hub.resetBase });
    const C = LIMITS.trailChunk;
    for (const id of this.dirty) {
      if (!hub.races[id]) {
        const gone = await this.ctx.storage.list({ prefix: `t|${id}|` });
        if (gone.size) await this.ctx.storage.delete([...gone.keys()]);
        for (const k of Object.keys(this.persisted)) if (k.startsWith(id + '|')) delete this.persisted[k];
        continue;
      }
      const items: Record<string, [number, number][]> = {};
      const drop: string[] = [];
      for (const [driverKey, pts] of Object.entries(hub.trails[id] ?? {})) {
        const rk = `${id}|${driverKey}`, before = this.persisted[rk] ?? 0;
        if (pts.length === before) continue;
        const trimmed = pts.length < before;     // the oldest chunk was dropped: chunk numbers shifted, rewrite all
        const from = trimmed ? 0 : Math.floor(before / C);
        const n = Math.ceil(pts.length / C);
        for (let c = from; c < n; c++) items[`t|${id}|${c}|${driverKey}`] = pts.slice(c * C, (c + 1) * C);
        if (trimmed) for (let c = n; c < Math.ceil(before / C); c++) drop.push(`t|${id}|${c}|${driverKey}`);
        this.persisted[rk] = pts.length;
      }
      const keys = Object.keys(items);
      for (let i = 0; i < keys.length; i += 100) await this.ctx.storage.put(Object.fromEntries(keys.slice(i, i + 100).map((k) => [k, items[k]])));
      if (drop.length) await this.ctx.storage.delete(drop);
    }
    this.dirty.clear();
  }

  private broadcast(raceId: string, msg: unknown) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(raceId)) { try { ws.send(text); } catch { /* closed */ } }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const hub = await this.load();
    const now = Date.now();

    if (url.pathname === '/push') {
      let raw: unknown;
      try { raw = JSON.parse(await req.text()); } catch { return json({ error: 'not JSON' }, 400); }
      const payload = cleanPayload(raw);
      if (!payload) return json({ error: 'expected { players: [...] }' }, 400);
      const { changed, added } = ingest(hub, payload, now);
      const ended = housekeeping(hub, now);
      for (const id of [...changed, ...ended]) {
        this.dirty.add(id);
        if (!hub.races[id]) continue;
        this.broadcast(id, { type: 'update', race: raceView(hub, id, false, now), add: added[id] ?? {} });
      }
      await this.persist(ended.length > 0);
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now + 60_000);
      return json({ ok: true, races: changed.length, players: payload.players.length });
    }

    if (url.pathname === '/races') return json({ now, races: listRaces(hub) });

    let m = /^\/race\/([\w-]+)$/.exec(url.pathname);
    if (m) {
      const v = raceView(hub, m[1], url.searchParams.get('trails') === '1', now);
      return v ? json(v) : json({ error: 'no such race' }, 404);
    }

    m = /^\/ws\/([\w-]+)$/.exec(url.pathname);
    if (m) {
      const id = m[1];
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [id]);
      const v = raceView(hub, id, true, now);
      server.send(JSON.stringify(v ? { type: 'snapshot', race: v } : { type: 'missing', id }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: 'not found' }, 404);
  }

  // viewers only listen; a "ping" text gets a "pong" so pages can check the connection
  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) { if (msg === 'ping') ws.send('pong'); }
  async webSocketClose(ws: WebSocket, code: number) { try { ws.close(code, 'bye'); } catch { /* already closed */ } }

  async alarm() {
    const hub = await this.load();
    const now = Date.now();
    const ended = housekeeping(hub, now);
    for (const id of ended) { this.dirty.add(id); if (hub.races[id]) this.broadcast(id, { type: 'update', race: raceView(hub, id, false, now), add: {} }); }
    await this.persist(true);
    if (Object.values(hub.races).length) await this.ctx.storage.setAlarm(now + 60_000);
  }
}
