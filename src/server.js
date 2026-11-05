import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan, GLOBAL_DERIVED_DATA } from './scanner.js';
import { runningTools, stopGradleDaemons, canTrash, moveToTrash } from './system.js';

const PORT = Number(process.env.PORT) || 4321;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');

// Histórico de espaço liberado, mantido entre execuções do app.
const STATS_FILE = path.join(os.homedir(), '.build-cleaner', 'stats.json');

const emptyStats = () => ({ totalFreed: 0, totalItems: 0, history: [] });

async function loadStats() {
  let raw;
  try {
    raw = await fs.readFile(STATS_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStats();
    throw err;
  }
  try {
    const s = JSON.parse(raw);
    if (typeof s.totalFreed !== 'number' || typeof s.totalItems !== 'number' || !Array.isArray(s.history)) {
      throw new Error('formato inválido');
    }
    return s;
  } catch {
    // Arquivo corrompido: guarda uma cópia em vez de sobrescrever o histórico.
    const backup = STATS_FILE.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
    await fs.rename(STATS_FILE, backup).catch(() => {});
    console.warn(`stats.json inválido; cópia salva em ${backup}`);
    return emptyStats();
  }
}

// Escreve num arquivo temporário e renomeia: uma queda no meio não corrompe o original.
async function saveStats(stats) {
  await fs.mkdir(path.dirname(STATS_FILE), { recursive: true });
  const tmp = `${STATS_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(stats, null, 2));
  await fs.rename(tmp, STATS_FILE);
}

// Serializa as gravações para que duas limpezas simultâneas não percam atualização.
let statsQueue = Promise.resolve();
function recordCleanup(freed, items, mode) {
  const job = statsQueue.then(async () => {
    const stats = await loadStats();
    stats.totalFreed += freed;
    stats.totalItems += items;
    stats.history.unshift({ date: new Date().toISOString(), freed, items, mode });
    stats.history = stats.history.slice(0, 200);
    await saveStats(stats);
    return stats;
  });
  statsQueue = job.catch(() => {});
  return job;
}

// Só caminhos encontrados no último scan podem ser deletados.
let allowed = new Map();
let currentScan = null;

const ARTIFACT_NAMES = new Set(['build', '.gradle', '.kotlin', '.cxx', '.externalNativeBuild',
  'DerivedData', '.build', 'Pods', '.dart_tool']);

function isSafeToDelete(p) {
  if (!allowed.has(p)) return false;
  if (path.dirname(p) === GLOBAL_DERIVED_DATA) return true;
  return ARTIFACT_NAMES.has(path.basename(p));
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

// Token aleatório por execução, injetado na página. Exigido em toda rota /api/*, inclusive GET,
// para que outro site não consiga disparar um scan via <img>/<script> (que não enviam Origin).
const TOKEN = crypto.randomBytes(24).toString('hex');

function hasValidToken(req, url) {
  const given = req.headers['x-build-cleaner-token'] || url.searchParams.get('token') || '';
  const a = Buffer.from(String(given));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Bloqueia requisições de outros sites (CSRF / DNS rebinding) contra o servidor local.
function isTrusted(req, url) {
  const okHosts = [`${HOST}:${PORT}`, `localhost:${PORT}`];
  if (!okHosts.includes(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !okHosts.some((h) => origin === `http://${h}`)) return false;
  if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json')) return false;
  if (url.pathname.startsWith('/api/') && !hasValidToken(req, url)) return false;
  return true;
}

function pickFolder() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve({ unsupported: true });
    const script = 'POSIX path of (choose folder with prompt "Escolha a pasta para procurar projetos iOS, Android e Flutter")';
    execFile('osascript', ['-e', script], (err, stdout) => {
      if (err) return resolve({ cancelled: true });
      resolve({ path: stdout.trim().replace(/\/$/, '') || '/' });
    });
  });
}

async function handleScan(req, res, url) {
  const target = (url.searchParams.get('path') || '').replace(/^~(?=$|\/)/, os.homedir());
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  currentScan?.abort();
  const controller = new AbortController();
  currentScan = controller;
  req.on('close', () => controller.abort());

  let lastProgress = 0;
  try {
    const projects = await scan(target, {
      signal: controller.signal,
      onProgress: (p) => {
        const now = Date.now();
        if (now - lastProgress > 150) {
          lastProgress = now;
          send('progress', p);
        }
      },
      onProject: (p) => send('project', { type: p.type, name: p.name, path: p.path }),
    });
    if (controller.signal.aborted) return;
    allowed = new Map(projects.flatMap((p) => p.artifacts.map((a) => [a.path, a])));
    send('done', { root: path.resolve(target), projects });
  } catch (err) {
    send('fail', { message: err.message });
  } finally {
    res.end();
  }
}

async function handleDelete(req, res) {
  const { paths, mode = 'delete' } = await readBody(req);
  if (!Array.isArray(paths)) return json(res, 400, { error: 'paths deve ser uma lista' });
  if (mode !== 'delete' && mode !== 'trash') return json(res, 400, { error: 'mode inválido' });
  if (mode === 'trash' && !(await canTrash())) return json(res, 400, { error: 'Lixeira não disponível neste sistema' });
  const results = [];
  for (const p of paths) {
    if (!isSafeToDelete(p)) {
      results.push({ path: p, ok: false, error: 'Caminho não autorizado (refaça o scan)' });
      continue;
    }
    try {
      if (mode === 'trash') await moveToTrash(p);
      else await fs.rm(p, { recursive: true, force: true, maxRetries: 2 });
      results.push({ path: p, ok: true, freed: allowed.get(p).size });
      allowed.delete(p);
    } catch (err) {
      results.push({ path: p, ok: false, error: err.message });
    }
  }
  const ok = results.filter((r) => r.ok);
  let stats = null;
  let statsError;
  try {
    stats = ok.length
      ? await recordCleanup(ok.reduce((s, r) => s + r.freed, 0), ok.length, mode)
      : await loadStats();
  } catch (err) {
    // As pastas já foram apagadas: o resultado precisa chegar à tela mesmo se o contador falhar.
    statsError = `Não foi possível atualizar o contador: ${err.message}`;
  }
  json(res, 200, { results, stats, statsError });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!isTrusted(req, url)) return json(res, 403, { error: 'Origem não permitida (recarregue a página)' });

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      const html = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      });
      return res.end(html.replace('__BUILD_CLEANER_TOKEN__', TOKEN));
    }
    if (req.method === 'GET' && url.pathname === '/api/info') {
      return json(res, 200, {
        platform: process.platform,
        home: os.homedir(),
        canPick: process.platform === 'darwin',
        canTrash: await canTrash(),
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/processes') {
      return json(res, 200, { tools: await runningTools() });
    }
    if (req.method === 'POST' && url.pathname === '/api/stop-gradle') {
      const stopped = await stopGradleDaemons();
      return json(res, 200, { stopped, tools: await runningTools() });
    }
    if (req.method === 'GET' && url.pathname === '/api/stats') {
      return json(res, 200, await loadStats());
    }
    if (req.method === 'POST' && url.pathname === '/api/pick-folder') {
      return json(res, 200, await pickFolder());
    }
    if (req.method === 'GET' && url.pathname === '/api/scan') {
      return handleScan(req, res, url);
    }
    if (req.method === 'POST' && url.pathname === '/api/delete') {
      return handleDelete(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/api/reveal') {
      const { path: p } = await readBody(req);
      if (process.platform === 'darwin' && typeof p === 'string' && path.isAbsolute(p)) execFile('open', ['-R', p]);
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'Não encontrado' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  const address = `http://localhost:${PORT}`;
  console.log(`Build Cleaner rodando em ${address}  (Ctrl+C para sair)`);
  if (process.env.NO_OPEN) return;
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(opener, [address], () => {});
});
