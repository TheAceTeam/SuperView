import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { parseCodexJsonlFile } from "../core/parser";
import { normalizeCodexLines } from "../core/normalizer";
import { IngestJob } from "../core/types";
import { SuperViewDatabase } from "../storage/database";
import { resolveCodexHome } from "../storage/paths";
import { parseCodexHistoryJsonlFile } from "./history";
import { scanRolloutFiles } from "./scanner";
import { getCommits, getRepoRoot } from "./git-provider";

export const INGEST_PROCESSOR_VERSION = "2026-05-27-token-count-v1";

export class IngestService {
  private running = new Set<string>();

  constructor(private db: SuperViewDatabase) {}

  start(codexHome?: string) {
    const now = new Date().toISOString();
    const job: IngestJob = {
      id: randomUUID(),
      status: "queued",
      startedAt: now,
      finishedAt: null,
      totalFiles: 0,
      processedFiles: 0,
      totalEvents: 0,
      errors: [],
      skippedFiles: 0
    };
    this.db.upsertJob(job);
    void this.run(job.id, codexHome);
    return job;
  }

  getJob(jobId: string) {
    return this.db.getJob(jobId);
  }

  private async run(jobId: string, codexHome?: string) {
    if (this.running.has(jobId)) return;
    this.running.add(jobId);
    const job = this.db.getJob(jobId);
    if (!job) return;

    try {
      job.status = "running";
      const files = await scanRolloutFiles(codexHome);
      const historyBySessionId = await loadHistoryBySessionId(codexHome);
      job.totalFiles = files.length;
      this.db.upsertJob(job);

      let projectCount = 0;
      let sessionCount = 0;

      for (const file of files) {
        try {
          const fileStat = await stat(file);
          const previous = this.db.getIngestedFile(file);
          if (previous && previous.mtimeMs === fileStat.mtimeMs && previous.sizeBytes === fileStat.size && previous.processorVersion === INGEST_PROCESSOR_VERSION) {
            job.skippedFiles = (job.skippedFiles ?? 0) + 1;
            job.processedFiles += 1;
            this.db.upsertJob(job);
            continue;
          }

          const lines = await parseCodexJsonlFile(file);
          const meta = lines.find((line) => line.type === "session_meta");
          const cwd = extractCwd(meta?.payload);
          const repoRoot = cwd ? await getRepoRoot(cwd) : null;
          const bundle = normalizeCodexLines(lines, { repoRoot });
          if (bundle) {
            bundle.historyPrompts = historyBySessionId.get(bundle.session.id) ?? [];
            bundle.gitCommits = repoRoot ? await getCommits(repoRoot, bundle.session.startedAt, bundle.session.endedAt) : [];
            this.db.upsertBundle(bundle);
            this.db.upsertIngestedFile({
              path: file,
              mtimeMs: fileStat.mtimeMs,
              sizeBytes: fileStat.size,
              sha256: lines.at(-1)?.sha256 ?? null,
              sessionId: bundle.session.id,
              processorVersion: INGEST_PROCESSOR_VERSION,
              processedAt: new Date().toISOString()
            });
            projectCount += 1;
            sessionCount += 1;
            job.totalEvents += bundle.events.length;
          } else {
            this.db.upsertIngestedFile({
              path: file,
              mtimeMs: fileStat.mtimeMs,
              sizeBytes: fileStat.size,
              sha256: lines.at(-1)?.sha256 ?? null,
              sessionId: null,
              processorVersion: INGEST_PROCESSOR_VERSION,
              processedAt: new Date().toISOString()
            });
          }
        } catch (error) {
          job.errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
        job.processedFiles += 1;
        this.db.upsertJob(job);
      }

      job.status = "completed";
      job.finishedAt = new Date().toISOString();
      this.db.upsertJob(job);
      return { projects: projectCount, sessions: sessionCount, events: job.totalEvents };
    } catch (error) {
      job.status = "failed";
      job.finishedAt = new Date().toISOString();
      job.errors.push(error instanceof Error ? error.message : String(error));
      this.db.upsertJob(job);
      return null;
    } finally {
      this.running.delete(jobId);
    }
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

function extractCwd(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "cwd" in payload && typeof payload.cwd === "string") {
    return payload.cwd;
  }
  return null;
}
