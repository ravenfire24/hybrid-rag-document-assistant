import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import { extname, join } from "path";
import { performance } from "perf_hooks";

type Env = Record<string, string>;

type BenchmarkReport = {
  generatedAt: string;
  command: string;
  summary: Record<string, unknown>;
  results?: unknown[];
};

const args = process.argv.slice(2);
const command = args[0] ?? "all";
const env = loadEnv();
const outputDir = argValue("--out") ?? "benchmarks";

async function main() {
  mkdirSync(outputDir, { recursive: true });

  if (command === "dataset") {
    writeReport("dataset", await datasetReport());
    return;
  }

  if (command === "qdrant") {
    writeReport("qdrant", await qdrantReport());
    return;
  }

  if (command === "queries") {
    writeReport("queries", await queryReport());
    return;
  }

  if (command === "load") {
    writeReport("load", await loadReport());
    return;
  }

  writeReport("all", {
    generatedAt: new Date().toISOString(),
    command: "all",
    summary: {
      dataset: (await datasetReport()).summary,
      qdrant: (await qdrantReport()).summary,
      queries: (await queryReport()).summary,
      load: (await loadReport()).summary
    }
  });
}

async function datasetReport(): Promise<BenchmarkReport> {
  const datasetDir = argValue("--dataset") ?? "data";
  const startedAt = performance.now();
  const supported = new Set([".pdf", ".txt", ".docx"]);
  const files = walk(datasetDir).filter((file) => supported.has(extname(file).toLowerCase()));
  const byType = files.reduce<Record<string, number>>((counts, file) => {
    const extension = extname(file).toLowerCase().slice(1) || "unknown";
    counts[extension] = (counts[extension] ?? 0) + 1;
    return counts;
  }, {});
  const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);

  return {
    generatedAt: new Date().toISOString(),
    command: "dataset",
    summary: {
      datasetDir,
      files: files.length,
      pdfs: byType.pdf ?? 0,
      txt: byType.txt ?? 0,
      docx: byType.docx ?? 0,
      totalBytes,
      durationMs: Math.round(performance.now() - startedAt)
    }
  };
}

async function qdrantReport(): Promise<BenchmarkReport> {
  const startedAt = performance.now();
  const collection = env.QDRANT_COLLECTION || "documents";
  const response = await qdrantFetch(`/collections/${collection}`);
  const payload = await response.json();

  if (!response.ok) {
    return {
      generatedAt: new Date().toISOString(),
      command: "qdrant",
      summary: {
        collection,
        ok: false,
        status: response.status,
        error: payload,
        durationMs: Math.round(performance.now() - startedAt)
      }
    };
  }

  const documents = await listDocuments(collection);

  return {
    generatedAt: new Date().toISOString(),
    command: "qdrant",
    summary: {
      collection,
      ok: true,
      pointsCount: payload.result?.points_count ?? 0,
      vectorsCount: payload.result?.vectors_count ?? 0,
      indexedDocuments: documents.length,
      durationMs: Math.round(performance.now() - startedAt)
    },
    results: documents
  };
}

async function queryReport(): Promise<BenchmarkReport> {
  const queryFile = argValue("--queries") ?? "benchmarks/queries.jsonl";
  const apiBase = argValue("--api") ?? "http://localhost:3000";
  const concurrency = Number(argValue("--concurrency") ?? "1");
  const questions = await readQueryFile(queryFile);

  if (!questions.length) {
    return emptyQueryReport("queries", queryFile);
  }

  const results = await runWithConcurrency(questions, concurrency, (question) =>
    askApi(apiBase, question)
  );

  return summarizeQueryResults("queries", queryFile, results);
}

async function loadReport(): Promise<BenchmarkReport> {
  const queryFile = argValue("--queries") ?? "benchmarks/queries.jsonl";
  const apiBase = argValue("--api") ?? "http://localhost:3000";
  const concurrency = Number(argValue("--concurrency") ?? "5");
  const repeats = Number(argValue("--repeats") ?? "3");
  const questions = await readQueryFile(queryFile);

  if (!questions.length) {
    return emptyQueryReport("load", queryFile);
  }

  const expanded = Array.from({ length: repeats }, () => questions).flat();
  const results = await runWithConcurrency(expanded, concurrency, (question) =>
    askApi(apiBase, question)
  );

  return summarizeQueryResults("load", queryFile, results, {
    concurrency,
    repeats,
    totalRequests: expanded.length
  });
}

async function askApi(apiBase: string, question: string) {
  const documentsResponse = await fetch(`${apiBase}/api/documents`, { cache: "no-store" });
  const documentsPayload = await documentsResponse.json() as {
    documents?: { documentId: string }[];
  };
  const documentIds = (documentsPayload.documents ?? []).map((document) => document.documentId);
  const startedAt = performance.now();
  const response = await fetch(`${apiBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, documentIds })
  });
  const payload = await response.json() as {
    answer?: string;
    cached?: boolean;
    error?: string;
  };

  return {
    question,
    ok: response.ok,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
    cached: Boolean(payload.cached),
    answerLength: String(payload.answer ?? "").length,
    error: payload.error
  };
}

function summarizeQueryResults(
  name: string,
  queryFile: string,
  results: Awaited<ReturnType<typeof askApi>>[],
  extra: Record<string, unknown> = {}
): BenchmarkReport {
  const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
  const errors = results.filter((result) => !result.ok).length;

  return {
    generatedAt: new Date().toISOString(),
    command: name,
    summary: {
      queryFile,
      requests: results.length,
      ok: results.length - errors,
      errors,
      cacheHits: results.filter((result) => result.cached).length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      maxMs: durations.at(-1) ?? 0,
      ...extra
    },
    results
  };
}

function emptyQueryReport(commandName: string, queryFile: string): BenchmarkReport {
  return {
    generatedAt: new Date().toISOString(),
    command: commandName,
    summary: {
      queryFile,
      requests: 0,
      error: "No query file found or the file has no questions."
    }
  };
}

async function listDocuments(collection: string) {
  const documents = new Map<string, { documentId: string; source: string; category: string; chunkCount: number }>();
  let offset: string | number | null | undefined = undefined;

  do {
    const response = await qdrantFetch(`/collections/${collection}/points/scroll`, {
      method: "POST",
      body: JSON.stringify({
        limit: 1000,
        offset,
        with_payload: true,
        with_vector: false
      })
    });

    if (!response.ok) {
      break;
    }

    const payload = await response.json() as {
      result?: {
        points?: { payload?: Record<string, unknown> }[];
        next_page_offset?: string | number | null;
      };
    };
    for (const point of payload.result?.points ?? []) {
      const item = point.payload ?? {};
      const documentId = String(item.document_id ?? "");
      if (!documentId) {
        continue;
      }

      const current = documents.get(documentId);
      documents.set(documentId, {
        documentId,
        source: String(item.source ?? "Unknown"),
        category: String(item.category ?? ""),
        chunkCount: (current?.chunkCount ?? 0) + 1
      });
    }

    offset = payload.result?.next_page_offset;
  } while (offset);

  return Array.from(documents.values());
}

function qdrantFetch(path: string, init: RequestInit = {}) {
  requireEnv("QDRANT_URL");
  requireEnv("QDRANT_API_KEY");

  return fetch(`${env.QDRANT_URL}${path}`, {
    ...init,
    headers: {
      "api-key": env.QDRANT_API_KEY,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

async function readQueryFile(path: string) {
  if (!existsSync(path)) {
    return [];
  }

  const questions: string[] = [];
  const reader = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.question === "string") {
        questions.push(parsed.question);
      }
    } catch {
      questions.push(trimmed);
    }
  }

  return questions;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
) {
  const results: R[] = [];
  let index = 0;

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        const item = items[currentIndex];
        if (item !== undefined) {
          results[currentIndex] = await worker(item);
        }
      }
    })
  );

  return results.filter((result): result is R => result !== undefined);
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);
    return stats.isDirectory() ? walk(path) : [path];
  });
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) {
    return 0;
  }

  return values[Math.min(values.length - 1, Math.floor((values.length - 1) * percentileValue))];
}

function writeReport(name: string, report: BenchmarkReport) {
  const path = join(outputDir, `${name}-${Date.now()}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Report written to ${path}`);
}

function argValue(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function loadEnv() {
  const loaded: Env = { ...process.env } as Env;

  if (!existsSync(".env.local")) {
    return loaded;
  }

  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) {
      continue;
    }

    const index = line.indexOf("=");
    loaded[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }

  return loaded;
}

function requireEnv(name: string) {
  if (!env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
