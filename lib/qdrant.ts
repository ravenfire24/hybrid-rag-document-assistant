import { config } from "@/lib/config";
import type { DocumentChunk, IndexedDocument, RetrievedChunk } from "@/lib/types";

type QdrantPoint = {
  id: string;
  score?: number;
  payload?: Record<string, unknown>;
};

type QueryResponse = {
  result?: {
    points?: QdrantPoint[];
  };
};

type ScrollResponse = {
  result?: {
    points?: QdrantPoint[];
    next_page_offset?: string | number | null;
  };
};

export async function ensureCollection(vectorSize: number) {
  const existing = await qdrantFetch(`/collections/${config.qdrantCollection}`, {
    method: "GET"
  });

  if (existing.ok) {
    await ensurePayloadIndexes();
    return;
  }

  if (existing.status !== 404) {
    throw new Error(`Qdrant collection check failed: ${await existing.text()}`);
  }

  const created = await qdrantFetch(`/collections/${config.qdrantCollection}`, {
    method: "PUT",
    body: JSON.stringify({
      vectors: {
        size: vectorSize,
        distance: "Cosine"
      }
    })
  });

  if (!created.ok) {
    throw new Error(`Qdrant collection create failed: ${await created.text()}`);
  }

  await ensurePayloadIndexes();
}

export async function upsertChunks(chunks: DocumentChunk[], vectors: number[][]) {
  if (chunks.length !== vectors.length) {
    throw new Error("Chunk/vector count mismatch.");
  }

  const response = await qdrantFetch(`/collections/${config.qdrantCollection}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({
      points: chunks.map((chunk, index) => ({
        id: chunk.id,
        vector: vectors[index],
        payload: chunkToPayload(chunk)
      }))
    })
  });

  if (!response.ok) {
    throw new Error(`Qdrant upsert failed: ${await response.text()}`);
  }
}

export async function searchChunks(queryVector: number[], documentIds: string[], limit = 30) {
  if (documentIds.length) {
    const collectionExists = await ensurePayloadIndexes();
    if (!collectionExists) {
      return [];
    }
  }

  const response = await qdrantFetch(`/collections/${config.qdrantCollection}/points/query`, {
    method: "POST",
    body: JSON.stringify({
      query: queryVector,
      limit,
      with_payload: true,
      filter: buildDocumentFilter(documentIds)
    })
  });

  if (response.status === 404) {
    return [];
  }

  const payload = (await response.json()) as QueryResponse;
  if (!response.ok) {
    throw new Error(`Qdrant query failed: ${JSON.stringify(payload)}`);
  }

  return (payload.result?.points ?? []).map(pointToChunk);
}

export async function listIndexedDocuments() {
  const documents = new Map<string, IndexedDocument>();
  let offset: string | number | null | undefined = undefined;

  do {
    const response = await qdrantFetch(`/collections/${config.qdrantCollection}/points/scroll`, {
      method: "POST",
      body: JSON.stringify({
        limit: 1000,
        offset,
        with_payload: true,
        with_vector: false
      })
    });

    if (response.status === 404) {
      return [];
    }

    const payload = (await response.json()) as ScrollResponse;
    if (!response.ok) {
      throw new Error(`Qdrant scroll failed: ${JSON.stringify(payload)}`);
    }

    for (const point of payload.result?.points ?? []) {
      const chunk = pointToChunk(point);
      const current = documents.get(chunk.documentId);
      documents.set(chunk.documentId, {
        documentId: chunk.documentId,
        source: chunk.source,
        category: chunk.category,
        chunkCount: (current?.chunkCount ?? 0) + 1
      });
    }

    offset = payload.result?.next_page_offset;
  } while (offset);

  return Array.from(documents.values()).sort((left, right) => left.source.localeCompare(right.source));
}

export async function deleteIndexedDocument(documentId: string) {
  const collectionExists = await ensurePayloadIndexes();
  if (!collectionExists) {
    return 0;
  }

  const response = await qdrantFetch(`/collections/${config.qdrantCollection}/points/delete?wait=true`, {
    method: "POST",
    body: JSON.stringify({
      filter: buildDocumentFilter([documentId])
    })
  });

  if (!response.ok) {
    throw new Error(`Qdrant document delete failed: ${await response.text()}`);
  }

  return 1;
}

export async function deleteAllIndexedDocuments() {
  const response = await qdrantFetch(`/collections/${config.qdrantCollection}`, {
    method: "DELETE"
  });

  if (response.ok || response.status === 404) {
    return;
  }

  throw new Error(`Qdrant collection delete failed: ${await response.text()}`);
}

async function ensurePayloadIndexes() {
  const existing = await qdrantFetch(`/collections/${config.qdrantCollection}`, {
    method: "GET"
  });

  if (existing.status === 404) {
    return false;
  }

  if (!existing.ok) {
    throw new Error(`Qdrant collection check failed: ${await existing.text()}`);
  }

  await createPayloadIndex("document_id", "keyword");
  return true;
}

async function createPayloadIndex(fieldName: string, fieldSchema: string) {
  const response = await qdrantFetch(`/collections/${config.qdrantCollection}/index?wait=true`, {
    method: "PUT",
    body: JSON.stringify({
      field_name: fieldName,
      field_schema: fieldSchema
    })
  });

  if (response.ok || response.status === 409) {
    return;
  }

  const body = await response.text();
  if (body.toLowerCase().includes("already exists")) {
    return;
  }

  throw new Error(`Qdrant payload index create failed: ${body}`);
}

function qdrantFetch(path: string, init: RequestInit) {
  return fetch(`${config.qdrantUrl}${path}`, {
    ...init,
    headers: {
      "api-key": config.qdrantApiKey,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
}

function buildDocumentFilter(documentIds: string[]) {
  if (!documentIds.length) {
    return undefined;
  }

  return {
    must: [
      {
        key: "document_id",
        match:
          documentIds.length === 1
            ? { value: documentIds[0] }
            : {
                any: documentIds
              }
      }
    ]
  };
}

function chunkToPayload(chunk: DocumentChunk) {
  return {
    chunk_id: chunk.id,
    document_id: chunk.documentId,
    source: chunk.source,
    category: chunk.category,
    page: chunk.page,
    chunk_index: chunk.chunkIndex,
    indexed_at: chunk.indexedAt,
    text: chunk.text
  };
}

function pointToChunk(point: QdrantPoint): RetrievedChunk {
  const payload = point.payload ?? {};
  return {
    id: String(payload.chunk_id ?? point.id),
    documentId: String(payload.document_id ?? ""),
    source: String(payload.source ?? "Unknown"),
    category: String(payload.category ?? ""),
    page: Number(payload.page ?? 0),
    chunkIndex: Number(payload.chunk_index ?? 0),
    indexedAt: String(payload.indexed_at ?? ""),
    text: String(payload.text ?? ""),
    score: point.score
  };
}
