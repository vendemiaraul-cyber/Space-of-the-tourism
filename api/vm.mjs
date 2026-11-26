// /api/vm: boots the "Chromium ISO", a persistent Vercel Sandbox VM with Chromium installed,
// and hands the game a WebSocket URL for the live browser stream.
//   POST {op, key}  or  GET ?op=...&key=...
//   op=status     → sandbox status
//   op=boot       → resume the VM if stopped, refresh the server code, start it, return {ws}
//   op=keepalive  → push the VM's stop deadline back while the screen is open
//   op=stop       → stop now (the filesystem is snapshotted automatically)
import { Sandbox } from '@vercel/sandbox';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const NAME = process.env.ISO_SANDBOX || 'sott-chromium-iso';
const PORT = 3000;
// core.js (BrowserHub) is fetched by start.sh from the pinned 3d-browser commit.
const FILES = ['server.mjs', 'start.sh', 'selftest.mjs'];
const KEEPALIVE_MS = 4 * 60 * 1000;

const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const domain = (sb) => { try { return sb.domain(PORT); } catch { return null; } };

async function handle(p) {
  if (!process.env.ACCESS_KEY) return json({ error: 'ACCESS_KEY is not set on the Vercel project' }, 500);
  if (String(p.key || '') !== process.env.ACCESS_KEY) return json({ error: 'Wrong or missing access key' }, 403);
  const op = String(p.op || 'status');
  const sb = await Sandbox.get({ name: NAME, resume: false });

  if (op === 'status') return json({ status: sb.status, url: domain(sb) });
  if (op === 'stop') { await sb.stop(); return json({ ok: true, status: 'stopped' }); }
  if (op === 'keepalive') {
    if (sb.status === 'running') await sb.extendTimeout(KEEPALIVE_MS).catch(() => {});
    return json({ status: sb.status });
  }
  if (op !== 'boot') return json({ error: 'unknown op' }, 400);

  const t0 = Date.now();
  const wasRunning = sb.status === 'running';
  // Keep the ISO image forever: its snapshot holds Chromium and the fonts.
  if (sb.snapshotExpiration !== 0) {
    await sb.update({ snapshotExpiration: 0, keepLastSnapshots: { count: 1, expiration: 0 } }).catch(() => {});
  }
  // Writing files resumes a stopped persistent sandbox from its last snapshot.
  const dir = path.join(process.cwd(), 'iso');
  const files = await Promise.all(FILES.map(async (f) => ({ path: `/vercel/iso/${f}`, content: await readFile(path.join(dir, f)) })));
  await sb.writeFiles(files);
  const run = await sb.runCommand({ cmd: 'bash', args: ['/vercel/iso/start.sh'], env: { ACCESS_KEY: process.env.ACCESS_KEY } });
  const log = String(await run.stdout()).trim();
  const url = domain(sb);
  return json({
    ok: run.exitCode === 0 && !!url,
    resumed: !wasRunning,
    url,
    ws: url ? url.replace(/^http/, 'ws') + '/api/ws' : null,
    bootMs: Date.now() - t0,
    log: log.slice(-300),
  }, run.exitCode === 0 ? 200 : 502);
}

async function safe(p) {
  try { return await handle(p); }
  catch (e) { return json({ error: String((e && e.message) || e).split('\n')[0] }, 500); }
}

export async function GET(request) {
  return safe(Object.fromEntries(new URL(request.url).searchParams));
}
export async function POST(request) {
  return safe(await request.json().catch(() => ({})));
}
