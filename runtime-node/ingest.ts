import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCodexJsonlFile } from "../core/parser";
import { normalizeCodexLines } from "../core/normalizer";
import { CodexHistoryPrompt, GitCommitRecord, IngestJob } from "../core/types";
import { SuperViewDatabase } from "../storage/database";
import { resolveCodexHome } from "../storage/paths";
import { parseCodexHistoryJsonlFile } from "./history";
import { scanRolloutFiles } from "./scanner";
import { getCommits, getRepoRoot } from "./git-provider";

export const INGEST_PROCESSOR_VERSION = "2026-05-27-token-count-v1";

export interface IngestStartResult {
  job: IngestJob;
  alreadyRunning: boolean;
}

interface RolloutCandidate {
  file: string;
  stats: Stats;
}

export class IngestService {
  private workersByJobId = new Map<string, ChildProcess>();

  constructor(private db: SuperViewDatabase) {}

  start(codexHome?: string): IngestStartResult {
    const activeJob = this.db.getActiveIngestJob();
    if (activeJob) {
      return { job: activeJob, alreadyRunning: true };
    }

    const now = new Date().toISOString();
    const job: IngestJob = {
      id: randomUUID(),
      status: "queued",
      phase: "queued",
      startedAt: now,
      finishedAt: null,
      totalFiles: 0,
      processedFiles: 0,
      totalEvents: 0,
      errors: [],
      skippedFiles: 0,
      candidateFiles: 0,
      changedFiles: 0,
      processedBytes: 0,
      totalBytes: 0,
      currentFile: null,
      workerPid: null,
      processorVersion: INGEST_PROCESSOR_VERSION
    };
    this.db.upsertJob(job);
    const worker = this.spawnWorker(job.id, codexHome);
    if (worker.pid) {
      job.workerPid = worker.pid;
      this.db.upsertJob(job);
    }
    return { job, alreadyRunning: false };
  }

  getJob(jobId: string) {
    return this.db.getJob(jobId);
  }

  private spawnWorker(jobId: string, codexHome?: string) {
    const { command, args } = buildWorkerCommand(jobId, codexHome);
    const worker = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["ignore", "ignore", "pipe"]
    });
    this.workersByJobId.set(jobId, worker);

    let stderr = "";
    worker.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      stderr = stderr.slice(-4000);
    });
    worker.on("error", (error) => {
      this.workersByJobId.delete(jobId);
      this.failActiveJob(jobId, `Ingest worker failed to start: ${error.message}`);
    });
    worker.on("exit", (code, signal) => {
      this.workersByJobId.delete(jobId);
      if (code === 0) return;
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      const detail = stderr.trim() ? `${reason}: ${stderr.trim()}` : reason;
      this.failActiveJob(jobId, `Ingest worker exited with ${detail}`);
    });
    return worker;
  }

  private failActiveJob(jobId: string, message: string) {
    const job = this.db.getJob(jobId);
    if (!job || (job.status !== "queued" && job.status !== "running")) {
      return;
    }
    job.status = "failed";
    job.phase = "failed";
    job.finishedAt = new Date().toISOString();
    job.currentFile = null;
    job.errors.push(message);
    this.db.upsertJob(job);
  }
}

export async function runIngestJob(db: SuperViewDatabase, jobId: string, codexHome?: string, options: { workerPid?: number | null } = {}) {
  const job = db.getJob(jobId);
  if (!job) {
    throw new Error(`Ingest job ${jobId} not found`);
  }

  try {
    job.status = "running";
    job.phase = "scanning";
    job.workerPid = options.workerPid ?? job.workerPid ?? null;
    job.processorVersion = INGEST_PROCESSOR_VERSION;
    db.upsertJob(job);

    const files = await scanRolloutFiles(codexHome);
    job.phase = "diffing";
    job.totalFiles = files.length;
    job.candidateFiles = files.length;
    db.upsertJob(job);

    const candidates: RolloutCandidate[] = [];
    let skippedFiles = 0;
    let skippedBytes = 0;
    let totalBytes = 0;

    for (const file of files) {
      const fileStats = await stat(file);
      totalBytes += fileStats.size;
      const previous = db.getIngestedFile(file);
      if (previous && previous.mtimeMs === fileStats.mtimeMs && previous.sizeBytes === fileStats.size && previous.processorVersion === INGEST_PROCESSOR_VERSION) {
        skippedFiles += 1;
        skippedBytes += fileStats.size;
      } else {
        candidates.push({ file, stats: fileStats });
      }
    }

    job.skippedFiles = skippedFiles;
    job.changedFiles = candidates.length;
    job.processedFiles = skippedFiles;
    job.processedBytes = skippedBytes;
    job.totalBytes = totalBytes;
    db.upsertJob(job);

    const historyBySessionId = candidates.length > 0 ? await loadHistoryForJob(db, job, codexHome) : new Map<string, CodexHistoryPrompt[]>();
    const repoRootsByCwd = new Map<string, string | null>();
    const commitsByRepoRoot = new Map<string, GitCommitRecord[]>();

    let projectCount = 0;
    let sessionCount = 0;

    for (const candidate of candidates) {
      job.phase = "parsing";
      job.currentFile = candidate.file;
      db.upsertJob(job);
      await maybeDelayForTests();

      try {
        const lines = await parseCodexJsonlFile(candidate.file);
        const meta = lines.find((line) => line.type === "session_meta");
        const cwd = extractCwd(meta?.payload);

        job.phase = "normalizing";
        db.upsertJob(job);
        const repoRoot = cwd ? await cachedRepoRoot(repoRootsByCwd, cwd) : null;
        const bundle = normalizeCodexLines(lines, { repoRoot });

        job.phase = "writing";
        db.upsertJob(job);
        if (bundle) {
          bundle.historyPrompts = historyBySessionId.get(bundle.session.id) ?? [];
          bundle.gitCommits = repoRoot ? await cachedCommits(commitsByRepoRoot, repoRoot, bundle.session.startedAt, bundle.session.endedAt) : [];
          db.upsertBundle(bundle);
          db.upsertIngestedFile({
            path: candidate.file,
            mtimeMs: candidate.stats.mtimeMs,
            sizeBytes: candidate.stats.size,
            sha256: lines.at(-1)?.sha256 ?? null,
            sessionId: bundle.session.id,
            processorVersion: INGEST_PROCESSOR_VERSION,
            processedAt: new Date().toISOString()
          });
          projectCount += 1;
          sessionCount += 1;
          job.totalEvents += bundle.events.length;
        } else {
          db.upsertIngestedFile({
            path: candidate.file,
            mtimeMs: candidate.stats.mtimeMs,
            sizeBytes: candidate.stats.size,
            sha256: lines.at(-1)?.sha256 ?? null,
            sessionId: null,
            processorVersion: INGEST_PROCESSOR_VERSION,
            processedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        job.errors.push(`${candidate.file}: ${error instanceof Error ? error.message : String(error)}`);
      }

      job.processedFiles += 1;
      job.processedBytes = (job.processedBytes ?? 0) + candidate.stats.size;
      job.currentFile = null;
      db.upsertJob(job);
    }

    job.status = "completed";
    job.phase = "completed";
    job.finishedAt = new Date().toISOString();
    job.currentFile = null;
    db.upsertJob(job);
    return { projects: projectCount, sessions: sessionCount, events: job.totalEvents };
  } catch (error) {
    job.status = "failed";
    job.phase = "failed";
    job.finishedAt = new Date().toISOString();
    job.currentFile = null;
    job.errors.push(error instanceof Error ? error.message : String(error));
    db.upsertJob(job);
    return null;
  }
}

async function loadHistoryBySessionId(codexHome?: string) {
  try {
    const sourcePath = `${codexHome ?? resolveCodexHome()}/history.jsonl`;
    return (await parseCodexHistoryJsonlFile(sourcePath)).bySessionId;
  } catch {
    return new Map();
  }
}

async function loadHistoryForJob(db: SuperViewDatabase, job: IngestJob, codexHome?: string) {
  job.phase = "loading_history";
  db.upsertJob(job);
  return loadHistoryBySessionId(codexHome);
}

async function cachedRepoRoot(cache: Map<string, string | null>, cwd: string) {
  if (cache.has(cwd)) return cache.get(cwd) ?? null;
  const repoRoot = await getRepoRoot(cwd);
  cache.set(cwd, repoRoot);
  return repoRoot;
}

async function cachedCommits(cache: Map<string, GitCommitRecord[]>, repoRoot: string, from?: string | null, to?: string | null) {
  let commits = cache.get(repoRoot);
  if (!commits) {
    commits = await getCommits(repoRoot);
    cache.set(repoRoot, commits);
  }
  return commits.filter((commit) => isCommitInWindow(commit, from, to));
}

function isCommitInWindow(commit: GitCommitRecord, from?: string | null, to?: string | null) {
  const commitMs = Date.parse(commit.timestamp);
  if (!Number.isFinite(commitMs)) return true;
  const fromMs = from ? Date.parse(from) : null;
  const toMs = to ? Date.parse(to) : null;
  if (fromMs !== null && Number.isFinite(fromMs) && commitMs < fromMs) return false;
  if (toMs !== null && Number.isFinite(toMs) && commitMs > toMs) return false;
  return true;
}

function buildWorkerCommand(jobId: string, codexHome?: string) {
  const workerPath = workerPathFromImportMeta();
  const tsxCli = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const args = [workerPath, jobId, ...(codexHome ? [codexHome] : [])];
  if (existsSync(tsxCli)) {
    return { command: process.execPath, args: [tsxCli, ...args] };
  }
  return { command: path.resolve(process.cwd(), "node_modules", ".bin", "tsx"), args };
}

function workerPathFromImportMeta() {
  const workerUrl = new URL("./ingest-worker.ts", import.meta.url);
  if (workerUrl.protocol === "file:") {
    return fileURLToPath(workerUrl);
  }
  return path.resolve(process.cwd(), "runtime-node", "ingest-worker.ts");
}

async function maybeDelayForTests() {
  const delayMs = Number(process.env.SUPERVIEW_TEST_INGEST_FILE_DELAY_MS ?? 0);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function extractCwd(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "cwd" in payload && typeof payload.cwd === "string") {
    return payload.cwd;
  }
  return null;
}
