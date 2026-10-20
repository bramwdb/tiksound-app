// TikSound server — haalt audio uit TikTok-links (via yt-dlp) en serveert de PWA.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const TMP = path.join(os.tmpdir(), 'tiksound');
fs.mkdirSync(TMP, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

function extract(url) {
  return new Promise((resolve, reject) => {
    const out = path.join(TMP, crypto.randomUUID() + '.%(ext)s');
    const args = [
      '-x', '--audio-format', 'm4a',
      '--no-playlist', '--no-simulate', '--no-warnings',
      '--print', 'after_move:%(title)s|||%(uploader)s|||%(filepath)s',
      '-o', out, url,
    ];
    execFile('yt-dlp', args, { timeout: 120000, maxBuffer: 1e7 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').trim().split('\n').pop();
        return reject(new Error(err.code === 'ENOENT' ? 'yt-dlp niet gevonden op de server' : msg));
      }
      const line = stdout.trim().split('\n').pop() || '';
      const [title, uploader, file] = line.split('|||');
      if (!file || !fs.existsSync(file)) return reject(new Error('Geen audio gevonden'));
      resolve({ title: title || 'TikTok sound', uploader: uploader || '', file });
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Voor de iPhone-app: eerst /api/prepare (info), dan /api/file/:id (download)
const ready = new Map(); // id -> { file, ts }
setInterval(() => {
  for (const [id, r] of ready) if (Date.now() - r.ts > 10 * 60e3) { fs.unlink(r.file, () => {}); ready.delete(id); }
}, 60e3);
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const isTikTok = u => /^https?:\/\/([a-z0-9-]+\.)*tiktok\.com\//i.test(u || '');

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/ping') return json(res, 200, { ok: true, app: 'tiksound' });

  if (req.method === 'POST' && req.url === '/api/prepare') {
    try {
      const { url } = JSON.parse(await readBody(req));
      if (!isTikTok(url)) return json(res, 400, { error: 'Dat is geen TikTok-link' });
      console.log('→', url);
      const { title, uploader, file } = await extract(url);
      const id = crypto.randomUUID();
      ready.set(id, { file, ts: Date.now() });
      console.log('✓', title);
      return json(res, 200, { id, title, uploader, size: fs.statSync(file).size });
    } catch (e) {
      console.log('✗', e.message);
      return json(res, 500, { error: e.message });
    }
  }

  const m = req.method === 'GET' && req.url.match(/^\/api\/file\/([0-9a-f-]{36})$/);
  if (m) {
    const r = ready.get(m[1]);
    if (!r) return json(res, 404, { error: 'Verlopen, probeer opnieuw' });
    ready.delete(m[1]);
    res.writeHead(200, { 'Content-Type': 'audio/mp4', 'Content-Length': fs.statSync(r.file).size });
    return fs.createReadStream(r.file).pipe(res).on('finish', () => fs.unlink(r.file, () => {}));
  }

  if (req.method === 'POST' && req.url === '/api/extract') {
    try {
      const { url } = JSON.parse(await readBody(req));
      if (!/^https?:\/\/([a-z0-9-]+\.)*tiktok\.com\//i.test(url || '')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Dat is geen TikTok-link' }));
      }
      console.log('→', url);
      const { title, uploader, file } = await extract(url);
      const stat = fs.statSync(file);
      res.writeHead(200, {
        'Content-Type': 'audio/mp4',
        'Content-Length': stat.size,
        'X-Title': encodeURIComponent(title),
        'X-Uploader': encodeURIComponent(uploader),
        'Access-Control-Expose-Headers': 'X-Title, X-Uploader',
      });
      fs.createReadStream(file).pipe(res).on('finish', () => fs.unlink(file, () => {}));
      console.log('✓', title);
    } catch (e) {
      console.log('✗', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Statische bestanden
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`TikSound draait op http://localhost:${PORT}`);
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  for (const ip of ips) console.log(`iPhone-app server-adres:  http://${ip}:${PORT}`);
  console.log('Voor je iPhone: start een HTTPS-tunnel, bijv.  cloudflared tunnel --url http://localhost:' + PORT);
});
