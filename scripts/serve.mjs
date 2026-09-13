import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFileWorldJournalStore, createMemoryWorldJournalStore } from '../src/hosted/journal-store.mjs';
import { createFileLocalSeatBindingStore } from '../src/hosted/local-seat-binding-store.mjs';
import { createFileWorldAccountStore, createMemoryWorldAccountStore } from '../src/hosted/world-account-store.mjs';
import { createWorldHttpApiService } from '../src/hosted/world-http-api.mjs';
import { createWorldSessionAuthority } from '../src/hosted/world-session-authority.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedPort = Number(process.argv[2] || process.env.PORT || 4174);
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536 ? requestedPort : 4174;

const journalPath = process.env.AXM_WORLD_JOURNAL_PATH
  ? path.resolve(process.env.AXM_WORLD_JOURNAL_PATH)
  : null;
const accountPath = process.env.AXM_WORLD_ACCOUNTS_PATH
  ? path.resolve(process.env.AXM_WORLD_ACCOUNTS_PATH)
  : null;
const localSeatBindingsPath = process.env.AXM_LOCAL_SEAT_BINDINGS_PATH
  ? path.resolve(process.env.AXM_LOCAL_SEAT_BINDINGS_PATH)
  : null;
const localSeatJournalDir = process.env.AXM_LOCAL_SEAT_JOURNAL_DIR
  ? path.resolve(process.env.AXM_LOCAL_SEAT_JOURNAL_DIR)
  : null;
if (Boolean(localSeatBindingsPath) !== Boolean(localSeatJournalDir)) {
  throw new Error('AXM_LOCAL_SEAT_BINDINGS_PATH and AXM_LOCAL_SEAT_JOURNAL_DIR must be configured together');
}
if (localSeatBindingsPath && !accountPath) {
  throw new Error('AXM_WORLD_ACCOUNTS_PATH is required when LOCAL RTS seat restart persistence is configured');
}
const requestedEpochMs = Number(process.env.AXM_WORLD_EPOCH_MS || 0);
const worldEpochMs = Number.isFinite(requestedEpochMs) && requestedEpochMs >= 0 ? requestedEpochMs : 0;
const sharedWriteMode = String(process.env.AXM_SHARED_WRITE_MODE || 'off');
const localSeatStoreFactory = localSeatJournalDir
  ? regionSeatId => createFileWorldJournalStore(path.join(localSeatJournalDir, `${regionSeatId}.jsonl`))
  : undefined;
const localSeatBindingStore = localSeatBindingsPath
  ? createFileLocalSeatBindingStore(localSeatBindingsPath)
  : null;

const worldSession = createWorldSessionAuthority({
  worldEpochMs,
  store: journalPath ? createFileWorldJournalStore(journalPath) : createMemoryWorldJournalStore(),
  accountStore: accountPath ? createFileWorldAccountStore(accountPath) : createMemoryWorldAccountStore(),
  ...(localSeatStoreFactory ? { localSeatStoreFactory } : {}),
  ...(localSeatBindingStore ? { localSeatBindingStore } : {})
});
const apiService = createWorldHttpApiService({
  authority: worldSession,
  writeMode: sharedWriteMode,
  clock: () => Date.now()
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
  let body = {};
  if (request.method === 'POST') {
    try {
      body = await readJsonBody(request);
    } catch (error) {
      json(response, 400, { error: error.message });
      return;
    }
  }
  const result = apiService.handle({
    method: request.method,
    pathname: url.pathname,
    searchParams: url.searchParams,
    body
  });
  json(response, result.status, result.body);
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400).end('Missing URL');
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  if (url.pathname.startsWith('/api/')) {
    await handleApi(request, response, url);
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
  const journal = journalPath ? `journal=${journalPath}` : 'journal=memory-only';
  const accounts = accountPath ? `accounts=${accountPath}` : 'accounts=memory-only';
  const localSeats = localSeatBindingsPath
    ? `local-seats=${localSeatBindingsPath}; local-seat-journals=${localSeatJournalDir}`
    : 'local-seats=process-only';
  console.log(`AXM Global State RTS shell: http://127.0.0.1:${port}/game/ (${journal}, ${accounts}, ${localSeats}, shared-writes=${sharedWriteMode})`);
});
