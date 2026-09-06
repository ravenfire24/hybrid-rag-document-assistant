import { config } from "@/lib/config";
import { TtlCache } from "@/lib/cache";
import type { RetrievedChunk } from "@/lib/types";

type EmbeddingResponse = {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
};

type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type RerankItem = {
  index?: number;
  score?: number;
  logit?: number;
  relevance_score?: number;
};

type RerankResponse = {
  rankings?: RerankItem[];
  results?: RerankItem[];
  data?: RerankItem[];
};

type ApiErrorPayload = {
  error?: unknown;
  detail?: unknown;
  message?: unknown;
  title?: unknown;
  status?: unknown;
};

const embeddingCache = new TtlCache<number[]>(24 * 60 * 60 * 1000, 5000);

export async function embedTexts(texts: string[], inputType: "passage" | "query") {
  if (!texts.length) {
    return [];
  }

  const cachedVectors = texts.map((text) => embeddingCache.get(embeddingCacheKey(text, inputType)));
  if (cachedVectors.every(Boolean)) {
    return cachedVectors as number[][];
  }

  const missingTexts = texts.filter((text, index) => !cachedVectors[index]);
  const response = await fetch(`${config.nvidiaEmbedBaseUrl}/embeddings`, {
    method: "POST",
    headers: nvidiaHeaders(),
    body: JSON.stringify({
      model: config.nvidiaEmbedModel,
      input: missingTexts,
      input_type: inputType,
      encoding_format: "float",
      truncate: "END"
    })
  });

  const payload = (await parseApiResponse(response)) as EmbeddingResponse & ApiErrorPayload;
  if (!response.ok) {
    throw new Error(`NVIDIA embeddings failed: ${formatApiError(payload)}`);
  }

  const missingVectors = payload.data
    .sort((left, right) => left.index - right.index)
    .map((item) => item.embedding);

  missingTexts.forEach((text, index) => {
    embeddingCache.set(embeddingCacheKey(text, inputType), missingVectors[index]);
  });

  return texts.map((text) => embeddingCache.get(embeddingCacheKey(text, inputType)) as number[]);
}

export async function rerank(question: string, chunks: RetrievedChunk[], limit: number) {
  if (!chunks.length) {
    return [];
  }

  const response = await fetch(config.nvidiaRerankUrl, {
    method: "POST",
    headers: nvidiaHeaders(),
    body: JSON.stringify({
      model: config.nvidiaRerankModel,
      query: { text: question },
      passages: chunks.map((chunk) => ({ text: chunk.text })),
      truncate: "END"
    })
  });

  const payload = (await parseApiResponse(response)) as RerankResponse & ApiErrorPayload;
  if (!response.ok) {
    throw new Error(`NVIDIA rerank failed: ${formatApiError(payload)}`);
  }

  const rows = payload.rankings ?? payload.results ?? payload.data ?? [];
  if (!rows.length) {
    return chunks.slice(0, limit);
  }

  return rows
    .map((item, fallbackIndex) => {
      const index = item.index ?? fallbackIndex;
      return {
        chunk: chunks[index],
        score: item.score ?? item.logit ?? item.relevance_score ?? 0
      };
    })
    .filter((item) => item.chunk)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ chunk, score }) => ({ ...chunk, score }));
}

export async function answerQuestion(question: string, chunks: RetrievedChunk[]) {
  const context = chunks
    .map(
      (chunk, index) =>
        `Context ${index + 1}:\n${chunk.text}`
    )
    .join("\n\n");

  const response = await fetch(`${config.nvidiaChatBaseUrl}/chat/completions`, {
    method: "POST",
    headers: nvidiaHeaders(),
    body: JSON.stringify({
      model: config.nvidiaChatModel,
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content:
            "You answer questions using only the provided document context. If the answer is not present, say exactly: I don't know."
        },
        {
          role: "user",
          content: `Question: ${question}\n\nContext:\n${context}\n\nAnswer directly and concisely. Do not include citations or source labels.`
        }
      ]
    })
  });

  const payload = (await parseApiResponse(response)) as ChatResponse & ApiErrorPayload;
  if (!response.ok) {
    throw new Error(`NVIDIA chat failed: ${formatApiError(payload)}`);
  }

  return cleanAnswer(payload.choices?.[0]?.message?.content ?? "") || "I don't know";
}

function nvidiaHeaders() {
  return {
    Authorization: `Bearer ${config.nvidiaApiKey}`,
    "Content-Type": "application/json"
  };
}

function embeddingCacheKey(text: string, inputType: "passage" | "query") {
  return `${config.nvidiaEmbedModel}:${inputType}:${text}`;
}

function cleanAnswer(answer: string) {
  return answer
    .trim()
    .replace(/\s*\((?:source|sources|citation|citations)\s*:\s*[^)]*\)\s*$/gi, "")
    .replace(/\s*\[(?:source|sources|citation|citations)\s*:\s*[^\]]*\]\s*$/gi, "")
    .replace(/\s*\(chunk\s+\d+\)\s*$/gi, "")
    .replace(/\s*\[chunk\s+\d+\]\s*$/gi, "")
    .trim();
}

async function parseApiResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function formatApiError(payload: ApiErrorPayload) {
  const value = payload.error ?? payload.detail ?? payload.message ?? payload.title ?? payload.status;

  if (!value) {
    return "API returned an error without a message";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}
