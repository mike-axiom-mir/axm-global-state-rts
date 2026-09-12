import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFileWorldJournalStore, createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createHostedSharedStateAuthority } from '../src/hosted/shared-state-authority.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedPort = Number(process.argv[2] || process.env.PORT || 4174);
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536 ? requestedPort : 4174;

const journalPath = process.env.AXM_WORLD_JOURNAL_PATH
  ? path.resolve(process.env.AXM_WORLD_JOURNAL_PATH)
  : null;
const sharedWriteMode = String(process.env.AXM_SHARED_WRITE_MODE || 'off');
const sharedState = createHostedSharedStateAuthority({
  store: journalPath ? createFileWorldJournalStore(journalPath) : createMemoryWorldJournalStore()
});

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.glb', 'model/gltf-binary']
]);

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded.replace(/^\/+/, '');
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

function json(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

function readJsonBody(request, { maxBytes = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text.length ? JSON.parse(text) : {});
      } catch (error) {
        reject(new Error(`invalid JSON body: ${error.message}`));
      }
    });
    request.on('error', reject);
  });
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/global-state/meta') {
    json(response, 200, sharedState.meta());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/global-state/leaderboard') {
    const metric = url.searchParams.get('metric') || 'dominance';
    const limit = Number(url.searchParams.get('limit') || 100);
    try {
      json(response, 200, {
        metric,
        revision: sharedState.meta().revision,
        entries: sharedState.leaderboard(metric, limit)
      });
    } catch (error) {
      json(response, 400, { error: error.message });
    }
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/global-state/player') {
    const playerId = url.searchParams.get('playerId');
    if (!playerId) {
      json(response, 400, { error: 'playerId query parameter required' });
      return true;
    }
    json(response, 200, {
      revision: sharedState.meta().revision,
      playerId,
      summary: sharedState.playerSummary(playerId)
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/global-state/command') {
    // Deliberately disabled by default. This is a development proof of the website-hosted write path,
    // not an invitation to trust arbitrary public browser score/world mutations before command proofs exist.
    if (sharedWriteMode !== 'dev') {
      json(response, 403, { error: 'shared writes disabled', writeMode: sharedWriteMode });
      return true;
    }
    try {
      const body = await readJsonBody(request);
      const result = sharedState.submit(body.command, {
        expectedRevision: body.expectedRevision === undefined ? sharedState.meta().revision : Number(body.expectedRevision)
      });
      const conflict = !result.accepted && String(result.reason || '').includes('conflict');
      json(response, result.accepted ? 200 : conflict ? 409 : 400, result);
    } catch (error) {
      json(response, 400, { error: error.message });
    }
    return true;
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400).end('Missing URL');
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  if (url.pathname.startsWith('/api/')) {
    if (await handleApi(request, response, url)) return;
    json(response, 404, { error: 'API route not found' });
    return;
  }

  if (url.pathname === '/') {
    response.writeHead(302, { Location: '/game/' }).end();
    return;
  }

  let target = safePath(request.url);
  if (!target) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    response.writeHead(404).end('Not found');
    return;
  }

  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw new Error('not a file');
    const contentType = MIME.get(path.extname(target).toLowerCase()) || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  const persistence = journalPath ? `journal=${journalPath}` : 'journal=memory-only';
  console.log(`AXM Global State RTS shell: http://127.0.0.1:${port}/game/ (${persistence}, shared-writes=${sharedWriteMode})`);
});
