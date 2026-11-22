// RIFT ARENA — load test: N simulated clients register, connect, queue and play inside live matches.
// Measures honest latency/throughput numbers (no invented claims). Run: node tests/loadtest.js [clients]
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const N = parseInt(process.argv[2] ?? '24', 10);
const PORT = 3790;
const base = `http://127.0.0.1:${PORT}`;
const XH = { 'X-Requested-With': 'rift-arena', 'Content-Type': 'application/json' };

async function main() {
  console.log(`RIFT ARENA load test — ${N} simulated clients`);
  const dataDir = `/tmp/ra-load-${Date.now()}`;
  const child = spawn(process.execPath, ['server/src/index.js'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, NODE_ENV: 'test', RATE_LIMIT_REGISTER: '500' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const poll = async () => {
      try { const r = await fetch(`${base}/healthz`); if (r.ok) return resolve(); } catch { /* booting */ }
      setTimeout(poll, 300);
    };
    poll();
    setTimeout(() => reject(new Error('boot timeout')), 15000);
  });
  console.log('server booted');

  const t0 = Date.now();
  const stats = { registered: 0, connected: 0, matchFound: 0, inputs: 0, snapshots: 0, errors: 0 };
  const matchLatencies = [];
  let snapshotWindow = { at: null, count: 0 };

  const users = [];
  const regStart = Date.now();
  for (let i = 0; i < N; i++) {
    const r = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: XH, body: JSON.stringify({ username: `load_${i}_${Date.now() % 1000000}`, password: 'loadtest1' }) });
    if (r.ok) { stats.registered++; users.push((await r.json()).token); } else stats.errors++;
  }
  console.log(`registered ${stats.registered}/${N} in ${((Date.now() - regStart) / 1000).toFixed(1)}s`);

  const results = await Promise.all(users.map(async (token, i) => {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); setTimeout(() => rej(new Error('ws timeout')), 8000); });
      stats.connected++;
      const qSent = Date.now();
      let matchAt = null, snapCount = 0;
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.t === 'snap') { stats.snapshots++; snapCount++; }
        if (m.t === 'match_found') { matchAt = Date.now() - qSent; stats.matchFound++; matchLatencies.push(matchAt); }
        if (m.t === 'error') stats.errors++;
      });
      ws.send(JSON.stringify({ t: 'auth', token }));
      await new Promise(r => setTimeout(r, 200));
      ws.send(JSON.stringify({ t: 'queue', mode: 'crystal_rush', ranked: false }));
      // play: send inputs once matched (bots fill after ~9s)
      const iv = setInterval(() => {
        if (ws.readyState !== 1) return clearInterval(iv);
        if (matchAt !== null) {
          ws.send(JSON.stringify({ t: 'in', seq: i, dx: Math.random() * 2 - 1, dy: Math.random() * 2 - 1, aim: Math.random() * 6.28, fire: Math.random() < 0.4 }));
          stats.inputs++;
          if (Math.random() < 0.02) ws.send(JSON.stringify({ t: 'in', wantSuper: true, dx: 0, dy: 0, aim: Math.random() * 6.28, fire: false }));
        }
      }, 60);
      // measure snapshot throughput in a stable window (after matches start)
      setTimeout(() => { snapshotWindow.at = Date.now(); snapshotWindow.count = stats.snapshots; }, 14000);
      // keep clients alive for the measurement window, then leave
      await new Promise(r => setTimeout(r, 22000));
      clearInterval(iv);
      ws.send(JSON.stringify({ t: 'cancel_queue' }));
      ws.close();
      return { matchAt, snapCount };
    } catch (e) { stats.errors++; return { matchAt: null, error: String(e) }; }
  }));

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const matched = results.filter(r => r.matchAt !== null);
  const avgLatency = matched.length ? (matchLatencies.reduce((a, b) => a + b, 0) / matched.length / 1000).toFixed(1) : 'n/a';
  const maxLatency = matched.length ? (Math.max(...matchLatencies) / 1000).toFixed(1) : 'n/a';
  const snapRate = snapshotWindow.at ? ((stats.snapshots - snapshotWindow.count) / ((Date.now() - snapshotWindow.at) / 1000)).toFixed(0) : 'n/a';

  console.log('--- RESULTS (mesuré, 22s de jeu live) ---');
  console.log(`connectés: ${stats.connected}/${users.length}`);
  console.log(`matchs trouvés (bots de remplissage): ${stats.matchFound}/${users.length}`);
  console.log(`latence matchmaking — moyenne: ${avgLatency}s, max: ${maxLatency}s (bot fill après 8s attendu)`);
  console.log(`snapshots reçus/s: ${snapRate} (attendu ≈ ${Math.max(1, stats.matchFound) * 15})`);
  console.log(`inputs client envoyés: ${stats.inputs}`);
  console.log(`erreurs: ${stats.errors}`);

  try {
    const { execSync } = await import('node:child_process');
    const ps = execSync(`ps -o rss= -p ${child.pid}`).toString().trim();
    console.log(`serveur RSS: ${(parseInt(ps) / 1024).toFixed(1)} MB`);
  } catch { /* optional */ }

  child.kill('SIGKILL');
  const ok = stats.connected >= users.length * 0.9 && stats.matchFound >= users.length * 0.8 && stats.errors < users.length * 0.2;
  console.log(ok ? 'LOAD TEST PASS' : 'LOAD TEST INCOMPLETE — voir les chiffres ci-dessus');
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('load test failed:', e); process.exit(1); });
