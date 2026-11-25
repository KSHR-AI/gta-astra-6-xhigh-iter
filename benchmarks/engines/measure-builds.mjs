#!/usr/bin/env node
// Run after other build/browser/CPU work stops:
//   node benchmarks/engines/measure-builds.mjs
// Each warm-up and measured build runs in a fresh child process, sequentially.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = dirname(SCRIPT);
const OUTPUT = join(ROOT, '.build-metrics');
const RESULTS = resolve(ROOT, '../results/web-builds.json');
const ENGINES = ['three', 'babylon', 'playcanvas'];
const PACKAGES = { three: 'three', babylon: '@babylonjs/core', playcanvas: 'playcanvas' };
const ORDER = [
  ['three', 'babylon', 'playcanvas'],
  ['babylon', 'playcanvas', 'three'],
  ['playcanvas', 'three', 'babylon'],
];
const METADATA_PREFIX = 'ASTRA_BUILD_METADATA ';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = path => path.replaceAll('\\', '/');

async function childBuild(engine) {
  if (!ENGINES.includes(engine)) throw new Error(`Unknown engine: ${engine}`);
  // Import inside the measured process so Vite/module startup is timed too.
  const { build } = await import('vite');
  const result = await build({
    configFile: false,
    envFile: false,
    root: ROOT,
    mode: 'production',
    publicDir: false,
    logLevel: 'error',
    clearScreen: false,
    build: {
      outDir: join(OUTPUT, engine),
      emptyOutDir: true,
      target: 'es2022',
      minify: 'esbuild',
      sourcemap: false,
      reportCompressedSize: false,
      lib: {
        entry: join(ROOT, 'src', `${engine}.js`),
        formats: ['es'],
        fileName: () => `${engine}.js`,
      },
      rollupOptions: { preserveEntrySignatures: 'strict' },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap(bundle => bundle.output).filter(file => file.type === 'chunk');
  const entries = chunks.filter(chunk => chunk.isEntry);
  if (entries.length !== 1 || !entries[0].exports.includes('createScene')) {
    throw new Error(`${engine}: library output must retain the createScene export.`);
  }
  const moduleIds = new Set(chunks.flatMap(chunk => Object.keys(chunk.modules)));
  // No config/main.js import may accidentally pull another engine into a trial.
  for (const other of ENGINES.filter(name => name !== engine)) {
    const packagePath = `/node_modules/${PACKAGES[other]}/`;
    if ([...moduleIds].some(id => slash(id).includes(packagePath))) {
      throw new Error(`${engine}: output unexpectedly includes ${PACKAGES[other]}.`);
    }
  }
  process.stdout.write(`${METADATA_PREFIX}${JSON.stringify({
    entryFile: entries[0].fileName,
    entryExports: entries[0].exports,
    bundledModuleCount: moduleIds.size,
    javascriptChunkCount: chunks.length,
  })}\n`);
}

async function artifactMetrics(engine) {
  const directory = join(OUTPUT, engine);
  const files = [];
  async function walk(path) {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const data = await readFile(absolute);
        const javascript = /\.(?:mjs|cjs|js)$/.test(entry.name);
        files.push({
          path: slash(relative(directory, absolute)),
          type: javascript ? 'javascript' : 'other',
          bytes: data.byteLength,
          ...(javascript ? { gzipBytes: gzipSync(data, { level: 9 }).byteLength } : {}),
          sha256: hash(data),
        });
      }
    }
  }
  await walk(directory);
  const javascript = files.filter(file => file.type === 'javascript');
  if (!javascript.length) throw new Error(`${engine}: no JavaScript artifact was emitted.`);
  return {
    javascriptBytes: javascript.reduce((sum, file) => sum + file.bytes, 0),
    javascriptGzipBytes: javascript.reduce((sum, file) => sum + file.gzipBytes, 0),
    allArtifactBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
}

function measureChild(engine) {
  return new Promise((resolveTrial, reject) => {
    const output = [];
    const errors = [];
    // Includes spawn, Node/Vite startup, module resolution, output cleanup,
    // bundling, minification, file writes, and normal process/stdio shutdown.
    const started = process.hrtime.bigint();
    const child = spawn(process.execPath, [SCRIPT, '--child', engine], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: 'production', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const interrupt = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.once('error', error => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      const elapsed = process.hrtime.bigint() - started;
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      resolveTrial({
        wallNanoseconds: elapsed.toString(),
        wallMilliseconds: Number(elapsed) / 1e6,
        exitCode,
        signal,
        stdout: Buffer.concat(output).toString('utf8'),
        stderr: Buffer.concat(errors).toString('utf8'),
      });
    });
  });
}

async function save(report) {
  await mkdir(dirname(RESULTS), { recursive: true });
  const temporary = `${RESULTS}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporary, RESULTS);
}

async function fingerprints() {
  const paths = ['package.json', 'package-lock.json', 'measure-builds.mjs',
    ...ENGINES.map(engine => `src/${engine}.js`)];
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(join(ROOT, path)))])));
}

async function installedVersion(packageName) {
  const manifest = JSON.parse(await readFile(join(ROOT, 'node_modules', packageName, 'package.json'), 'utf8'));
  return manifest.version;
}

function summarize(trials) {
  const durations = trials.map(trial => trial.wallMilliseconds).sort((a, b) => a - b);
  const mean = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const manifests = trials.map(trial => JSON.stringify(trial.artifacts.files));
  return {
    measuredTrials: trials.length,
    wallMilliseconds: {
      raw: trials.map(trial => trial.wallMilliseconds),
      median: median(durations),
      mean,
      min: durations[0],
      max: durations.at(-1),
      populationStandardDeviation: Math.sqrt(durations.reduce((sum, duration) => sum + (duration - mean) ** 2, 0) / durations.length),
    },
    javascriptBytes: median(trials.map(trial => trial.artifacts.javascriptBytes)),
    javascriptGzipBytes: median(trials.map(trial => trial.artifacts.javascriptGzipBytes)),
    allArtifactBytes: median(trials.map(trial => trial.artifacts.allArtifactBytes)),
    artifactsIdenticalAcrossTrials: manifests.every(manifest => manifest === manifests[0]),
  };
}

async function measure() {
  await mkdir(join(OUTPUT, 'logs'), { recursive: true });
  const versions = Object.fromEntries(await Promise.all(
    ['vite', 'three', '@babylonjs/core', '@babylonjs/loaders', 'playcanvas']
      .map(async name => [name, await installedVersion(name)]),
  ));
  const processors = cpus();
  const report = {
    schemaVersion: 1,
    status: 'running',
    startedAt: new Date().toISOString(),
    metric: 'Production JavaScript adapter/library clean rebuild, with warmed filesystem caches',
    scope: {
      included: 'Selected engine, its imported loaders and the src/<engine>.js createScene adapter; fresh Node process per build.',
      excluded: 'Common benchmark UI, scene JSON, GLB/textures/audio, browser startup/runtime, dependency installation, and post-build gzip/hash measurement.',
      godot: 'Godot import/export timing is separate. Its exported runtime and packed project are not bit-identical to these JavaScript libraries; do not present export time or artifact size as the same metric.',
    },
    methodology: {
      warmupsPerEngine: 1,
      measuredTrialsPerEngine: 3,
      warmupOrder: ENGINES,
      measuredOrder: ORDER,
      orderRationale: 'Fixed Latin-square rotation gives each engine each within-round position once; all children run sequentially.',
      warmDefinition: 'One preliminary build per engine primes OS/filesystem caches and is excluded from summary statistics; every measured trial still starts a new Node/Vite process and clears its output directory. This is not HMR or an incremental-cache measurement.',
      clock: 'Monotonic process.hrtime.bigint around child spawn through close (including stdio shutdown); raw nanoseconds and milliseconds retained.',
      gzip: 'Sum of separately gzip-compressed emitted JavaScript files at zlib level 9; gzip work occurs after the timed process exits.',
      build: {
        configFile: false, envFile: false, publicDir: false, mode: 'production',
        format: 'es', target: 'es2022', minify: 'esbuild', sourcemap: false,
        preserveEntrySignatures: 'strict', expectedExport: 'createScene',
        outputDirectory: '.build-metrics/<engine>', emptyOutDir: true,
        note: 'Vite ES library mode preserves whitespace/pure annotations needed by downstream tree-shaking. All three engines use the same library-build configuration.',
      },
      isolation: 'Run with other CPU-heavy tasks and browsers paused; this script serializes its own work but cannot ensure the host is otherwise idle.',
    },
    environment: {
      node: process.version, versions,
      platform: platform(), architecture: arch(), kernelRelease: release(),
      cpuModel: processors[0]?.model ?? 'unknown', logicalCpuCount: processors.length,
      reportedSystemMemoryBytes: totalmem(),
    },
    inputSha256Before: await fingerprints(),
    warmups: [],
    trials: [],
    summary: {},
  };
  await save(report);
  let sequence = 0;
  async function run(engine, phase, round, position) {
    const label = `${phase}-${round}-${position}-${engine}`;
    process.stderr.write(`${label}: building in a fresh Node process…\n`);
    const result = await measureChild(engine);
    const log = join(OUTPUT, 'logs', `${label}.log`);
    await writeFile(log, `STDOUT\n${result.stdout}\nSTDERR\n${result.stderr}`);
    const metadataLine = result.stdout.split(/\r?\n/).find(line => line.startsWith(METADATA_PREFIX));
    const trial = {
      sequence: ++sequence, phase, round, position, engine,
      wallNanoseconds: result.wallNanoseconds,
      wallMilliseconds: result.wallMilliseconds,
      exitCode: result.exitCode, signal: result.signal,
      log: slash(relative(ROOT, log)),
    };
    (phase === 'warmup' ? report.warmups : report.trials).push(trial);
    if (result.exitCode !== 0 || !metadataLine) {
      trial.error = (result.stderr || result.stdout || `Child exited with ${result.signal || result.exitCode}`).slice(-12000);
      throw new Error(`${label} failed. See ${trial.log}`);
    }
    trial.bundle = JSON.parse(metadataLine.slice(METADATA_PREFIX.length));
    trial.artifacts = await artifactMetrics(engine);
    await save(report);
    process.stderr.write(`${label}: ${(trial.wallMilliseconds / 1000).toFixed(3)} s; ${trial.artifacts.javascriptBytes} JS bytes; ${trial.artifacts.javascriptGzipBytes} gzip bytes\n`);
  }
  try {
    for (const [position, engine] of ENGINES.entries()) await run(engine, 'warmup', 0, position + 1);
    for (const [round, order] of ORDER.entries()) {
      for (const [position, engine] of order.entries()) await run(engine, 'measured', round + 1, position + 1);
    }
    report.inputSha256After = await fingerprints();
    report.inputsUnchanged = JSON.stringify(report.inputSha256Before) === JSON.stringify(report.inputSha256After);
    if (!report.inputsUnchanged) throw new Error('Benchmark inputs changed during the run; repeat with stable source files.');
    report.summary = Object.fromEntries(ENGINES.map(engine => [engine, summarize(report.trials.filter(trial => trial.engine === engine))]));
    report.status = 'complete';
    report.completedAt = new Date().toISOString();
    await save(report);
    process.stdout.write(`${JSON.stringify({ results: slash(relative(resolve(ROOT, '../..'), RESULTS)), summary: report.summary }, null, 2)}\n`);
  } catch (error) {
    report.status = 'failed';
    report.failedAt = new Date().toISOString();
    report.error = error.message;
    await save(report);
    throw error;
  }
}

try {
  if (process.argv[2] === '--child') await childBuild(process.argv[3]);
  else if (process.argv.length === 2) await measure();
  else throw new Error('Usage: node benchmarks/engines/measure-builds.mjs');
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}
