import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const GLOBAL_DERIVED_DATA = path.join(os.homedir(), 'Library/Developer/Xcode/DerivedData');

// Pastas que nunca precisamos percorrer procurando projetos.
const SKIP_DIRS = new Set([
  'node_modules', 'Pods', 'build', 'DerivedData', 'Carthage',
]);
// Dentro de um projeto Android, módulos não ficam nessas pastas.
const MODULE_SKIP = new Set(['src', 'res', 'assets', 'gradle', 'libs']);
const SKIP_SUFFIXES = ['.xcodeproj', '.xcworkspace', '.app', '.framework', '.xcframework',
  '.xcassets', '.bundle', '.lproj', '.playground', '.photoslibrary', '.dSYM'];

// Pastas de sistema que só são percorridas se o usuário escolher exatamente uma delas como raiz.
// /Volumes contém discos externos e de rede; /System/Volumes/Data duplica a árvore inteira no macOS.
const SYSTEM_DIRS = new Set([
  '/System', '/Volumes', '/private', '/dev', '/cores', '/Library', '/Applications', '/usr', '/bin', '/sbin',
  '/proc', '/sys', '/run', '/mnt', '/media', '/snap', '/boot', '/lib', '/lib64', '/etc', '/var', '/tmp',
]);

function shouldSkip(name, parentDir) {
  if (name.startsWith('.')) return true;
  if (SKIP_DIRS.has(name)) return true;
  if (SKIP_SUFFIXES.some((s) => name.endsWith(s))) return true;
  // Escanear a home inteira não deve entrar em ~/Library.
  if (name === 'Library' && parentDir === os.homedir()) return true;
  return false;
}

async function isDir(p) {
  try {
    return (await fs.lstat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function readText(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return '';
  }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// ---------- Detecção ----------

async function detectAndroid(dir, names) {
  const hasSettings = names.has('settings.gradle') || names.has('settings.gradle.kts');
  const hasBuild = names.has('build.gradle') || names.has('build.gradle.kts');
  if (!hasSettings && !(hasBuild && names.has('gradlew'))) return null;

  const files = ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts',
    'gradle/libs.versions.toml', 'app/build.gradle', 'app/build.gradle.kts'];
  const texts = await Promise.all(files.map((f) => readText(path.join(dir, f))));
  const all = texts.join('\n');
  if (!/com\.android|android\s*\{|plugins\.android|androidx?[.:]/i.test(all) && !(await isDir(path.join(dir, 'app/src/main')))) {
    return null;
  }
  const m = all.match(/rootProject\.name\s*=\s*["']([^"']+)["']/);
  let name = m ? m[1] : path.basename(dir);
  if (!m && name.toLowerCase() === 'android') name = path.basename(path.dirname(dir));
  return { type: 'android', name, path: dir };
}

function detectIOS(dir, entries) {
  const proj = entries.find((e) => e.isDirectory() && (e.name.endsWith('.xcworkspace') || e.name.endsWith('.xcodeproj')));
  const podfile = entries.some((e) => e.isFile() && e.name === 'Podfile');
  if (!proj && !podfile) return null;
  const xcodeproj = entries.find((e) => e.isDirectory() && e.name.endsWith('.xcodeproj'));
  let name = (xcodeproj || proj)?.name.replace(/\.(xcodeproj|xcworkspace)$/, '') || path.basename(dir);
  if (name === 'Runner') name = path.basename(path.dirname(dir)); // Flutter
  return { type: 'ios', name, path: dir };
}

async function detectFlutter(dir, names) {
  if (!names.has('pubspec.yaml')) return null;
  const text = await readText(path.join(dir, 'pubspec.yaml'));
  if (!/sdk:\s*flutter/.test(text)) return null;
  const m = text.match(/^name:\s*(\S+)/m);
  return { type: 'flutter', name: m ? m[1] : path.basename(dir), path: dir };
}

// ---------- Artefatos ----------

async function collect(candidates) {
  const out = [];
  for (const c of candidates) {
    if (await isDir(c.path)) out.push({ recommended: true, ...c });
  }
  return out;
}

async function androidArtifacts(root) {
  const candidates = [
    { path: path.join(root, '.gradle'), label: 'Cache do Gradle (.gradle)' },
    { path: path.join(root, '.kotlin'), label: 'Dados de sessão do Kotlin (.kotlin)' },
    { path: path.join(root, 'build'), label: 'build/ (raiz)' },
  ];

  async function walkModules(dir, depth) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = new Set(entries.map((e) => e.name));
    const rel = path.relative(root, dir) || '.';
    if (dir !== root && (names.has('build.gradle') || names.has('build.gradle.kts'))) {
      candidates.push({ path: path.join(dir, 'build'), label: `${rel}/build` });
    }
    candidates.push(
      { path: path.join(dir, '.cxx'), label: `${rel}/.cxx (NDK)` },
      { path: path.join(dir, '.externalNativeBuild'), label: `${rel}/.externalNativeBuild (NDK)` },
    );
    if (depth >= 4) return;
    for (const e of entries) {
      if (e.isDirectory() && !shouldSkip(e.name, dir) && !MODULE_SKIP.has(e.name)) {
        await walkModules(path.join(dir, e.name), depth + 1);
      }
    }
  }
  await walkModules(root, 0);
  return collect(candidates);
}

async function iosArtifacts(root, derivedData) {
  const list = await collect([
    { path: path.join(root, 'build'), label: 'build/ (saída do xcodebuild)' },
    { path: path.join(root, 'DerivedData'), label: 'DerivedData local' },
    { path: path.join(root, '.build'), label: '.build (Swift Package Manager)' },
    { path: path.join(root, 'Pods'), label: 'Pods (recriado com "pod install")', recommended: false },
  ]);
  for (const d of derivedData) {
    if (d.workspace && (isInside(d.workspace, root) || path.dirname(d.workspace) === root)) {
      list.push({ path: d.path, label: `DerivedData global (${path.basename(d.path)})`, recommended: true, global: true });
    }
  }
  return list;
}

async function flutterArtifacts(root) {
  return collect([
    { path: path.join(root, 'build'), label: 'build/ (saída do Flutter)' },
    { path: path.join(root, '.dart_tool'), label: '.dart_tool (recriado com "flutter pub get")' },
  ]);
}

// Mapeia as pastas de ~/Library/Developer/Xcode/DerivedData para o workspace de origem.
export async function loadDerivedData() {
  if (process.platform !== 'darwin') return [];
  let entries;
  try {
    entries = await fs.readdir(GLOBAL_DERIVED_DATA, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries.filter((e) => e.isDirectory() && e.name !== 'ModuleCache.noindex');
  return Promise.all(dirs.map(async (e) => {
    const p = path.join(GLOBAL_DERIVED_DATA, e.name);
    try {
      const { stdout } = await run('plutil', ['-extract', 'WorkspacePath', 'raw', '-o', '-', path.join(p, 'info.plist')]);
      return { path: p, workspace: stdout.trim() };
    } catch {
      return { path: p, workspace: null };
    }
  }));
}

// ---------- Tamanho ----------

async function nodeSize(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    let st;
    try {
      st = await fs.lstat(cur);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      try {
        for (const n of await fs.readdir(cur)) stack.push(path.join(cur, n));
      } catch {}
    } else {
      total += st.size;
    }
  }
  return total;
}

export async function dirSize(p) {
  if (process.platform !== 'win32') {
    try {
      const { stdout } = await run('du', ['-sk', p], { maxBuffer: 1024 * 1024 });
      return parseInt(stdout, 10) * 1024;
    } catch (err) {
      // du sai com código != 0 se algum arquivo não puder ser lido, mas ainda imprime o total.
      const n = parseInt(err.stdout, 10);
      if (!Number.isNaN(n)) return n * 1024;
    }
  }
  return nodeSize(p);
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

// ---------- Scan principal ----------

export async function scan(rootInput, { onProgress = () => {}, onProject = () => {}, signal, maxDepth = 15 } = {}) {
  const root = path.resolve(rootInput);
  if (!(await isDir(root))) throw new Error(`Pasta não encontrada: ${root}`);
  // Não atravessa para outros volumes (discos externos, rede, imagens montadas).
  const rootDev = (await fs.lstat(root)).dev;

  const derivedData = await loadDerivedData();
  const projects = [];
  let visited = 0;

  async function walk(dir, depth, ctx) {
    if (signal?.aborted) return;
    if (dir !== root) {
      if (SYSTEM_DIRS.has(dir)) return;
      try {
        if ((await fs.lstat(dir)).dev !== rootDev) return;
      } catch {
        return;
      }
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (++visited % 100 === 0) onProgress({ phase: 'scan', visited, current: dir });

    const names = new Set(entries.map((e) => e.name));
    const next = { ...ctx };
    const found = [];

    if (!ctx.android) {
      const p = await detectAndroid(dir, names);
      if (p) {
        found.push(p);
        next.android = dir;
      }
    }
    if (!ctx.ios) {
      const p = detectIOS(dir, entries);
      if (p) {
        found.push(p);
        next.ios = dir;
      }
    }
    if (!ctx.flutter) {
      const p = await detectFlutter(dir, names);
      if (p) {
        found.push(p);
        next.flutter = dir;
      }
    }

    for (const p of found) {
      p.artifacts = p.type === 'android' ? await androidArtifacts(dir)
        : p.type === 'ios' ? await iosArtifacts(dir, derivedData)
        : await flutterArtifacts(dir);
      projects.push(p);
      onProject(p);
    }

    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (e.isDirectory() && !shouldSkip(e.name, dir)) {
        await walk(path.join(dir, e.name), depth + 1, next);
      }
    }
  }

  onProgress({ phase: 'scan', visited: 0, current: root });
  await walk(root, 0, {});

  // Um mesmo diretório pode ser apontado por dois projetos (ex.: build/ do Flutter e do Android).
  const seen = new Set();
  for (const p of projects) {
    p.artifacts = p.artifacts.filter((a) => !seen.has(a.path) && seen.add(a.path));
  }

  const all = projects.flatMap((p) => p.artifacts);
  let done = 0;
  await mapLimit(all, 6, async (a) => {
    if (signal?.aborted) return;
    a.size = await dirSize(a.path);
    onProgress({ phase: 'size', done: ++done, total: all.length, current: a.path });
  });

  for (const p of projects) {
    p.artifacts = p.artifacts.filter((a) => a.size > 0);
    p.totalSize = p.artifacts.reduce((s, a) => s + a.size, 0);
  }
  return projects.sort((a, b) => b.totalSize - a.totalSize);
}
