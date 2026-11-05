// Integração com o sistema: ferramentas abertas que podem estar usando as pastas de build
// e envio de pastas para a Lixeira.
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const TOOLS = [
  { kind: 'xcode', label: 'Xcode', test: (args) => /\/Xcode[^/]*\.app\/Contents\/MacOS\/Xcode(\s|$)/.test(args) },
  {
    kind: 'android-studio',
    label: 'Android Studio',
    test: (args) => /\/Android Studio[^/]*\.app\/Contents\/MacOS\/studio(\s|$)/.test(args)
      || /\/android-studio\/bin\/studio(\.sh)?(\s|$)/.test(args),
  },
  { kind: 'gradle', label: 'Daemon do Gradle', test: (args) => /org\.gradle\.launcher\.daemon\.bootstrap\.GradleDaemon/.test(args) },
];

// Processos do usuário atual: [{ pid, args }].
async function listOwnProcesses() {
  if (process.platform === 'win32') return [];
  try {
    const { stdout } = await run('ps', ['-U', String(os.userInfo().uid), '-o', 'pid=,args='], { maxBuffer: 16 * 1024 * 1024 });
    return stdout.split('\n').map((line) => {
      const m = line.match(/^\s*(\d+)\s+(.*)$/);
      return m && { pid: Number(m[1]), args: m[2] };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// Ferramentas de build abertas agora, agrupadas por tipo: [{ kind, label, count, pids }].
export async function runningTools() {
  const procs = await listOwnProcesses();
  return TOOLS.map((t) => {
    const pids = procs.filter((p) => p.pid !== process.pid && t.test(p.args)).map((p) => p.pid);
    return { kind: t.kind, label: t.label, count: pids.length, pids };
  }).filter((t) => t.count);
}

// Envia SIGTERM aos daemons do Gradle do usuário (o daemon encerra de forma limpa).
// A lista é refeita aqui no servidor; nunca confiamos em PIDs vindos do navegador.
export async function stopGradleDaemons() {
  const gradle = (await runningTools()).find((t) => t.kind === 'gradle');
  let stopped = 0;
  for (const pid of gradle?.pids || []) {
    try {
      process.kill(pid, 'SIGTERM');
      stopped++;
    } catch {}
  }
  return stopped;
}

// ---------- Lixeira ----------

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

let trashMethod;
async function detectTrash() {
  if (trashMethod !== undefined) return trashMethod;
  if (process.platform === 'darwin') {
    // macOS 15+ tem /usr/bin/trash; antes disso, pede ao Finder.
    trashMethod = (await exists('/usr/bin/trash')) ? 'trash-cli' : 'finder';
  } else if (process.platform === 'linux') {
    try {
      await run('gio', ['--version']);
      trashMethod = 'gio';
    } catch {
      trashMethod = null;
    }
  } else {
    trashMethod = null;
  }
  return trashMethod;
}

export async function canTrash() {
  return Boolean(await detectTrash());
}

export async function moveToTrash(p) {
  const method = await detectTrash();
  if (method === 'trash-cli') return run('/usr/bin/trash', [p]);
  if (method === 'finder') {
    // O caminho vai como argumento (argv), nunca interpolado no script.
    return run('osascript', [
      '-e', 'on run argv',
      '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
      '-e', 'end run',
      p,
    ]);
  }
  if (method === 'gio') return run('gio', ['trash', '--', p]);
  throw new Error('Lixeira não disponível neste sistema');
}
