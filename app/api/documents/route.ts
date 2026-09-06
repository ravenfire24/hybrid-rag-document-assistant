import { NextRequest, NextResponse } from "next/server";
import { assertServerConfig } from "@/lib/config";
import { embedTexts } from "@/lib/nvidia";
import { clearAnswerCache } from "@/lib/rag-cache";
import {
  deleteAllIndexedDocuments,
  deleteIndexedDocument,
  ensureCollection,
  listIndexedDocuments,
  upsertChunks
} from "@/lib/qdrant";
import { extractText, fileHash, splitIntoChunks } from "@/lib/text";
import { logMetric, timed } from "@/lib/metrics";

const SUPPORTED_TYPES = new Set(["pdf", "txt", "docx"]);
const EMBED_BATCH_SIZE = 16;

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    assertServerConfig();
    const documents = await timed("documents.list", {}, () => listIndexedDocuments());
    return NextResponse.json({ documents });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertServerConfig();
    const formData = await request.formData();
    const files = formData.getAll("files").filter((item): item is File => item instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: "Attach at least one PDF, TXT, or DOCX file." }, { status: 400 });
    }

    const documentIds: string[] = [];
    let totalChunks = 0;
    let collectionReady = false;

    for (const file of files) {
      const category = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!SUPPORTED_TYPES.has(category)) {
        return NextResponse.json({ error: `Unsupported file type: ${file.name}` }, { status: 400 });
      }

      const fileStartedAt = performance.now();
      const documentId = await fileHash(file);
      const text = await timed("documents.extract", { source: file.name, bytes: file.size }, () => extractText(file));
      const chunks = splitIntoChunks({
        text,
        documentId,
        source: file.name,
        category
      });

      if (!chunks.length) {
        continue;
      }

      for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
        const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
        const vectors = await timed(
          "documents.embed_batch",
          { source: file.name, batchSize: batch.length },
          () =>
            embedTexts(
              batch.map((chunk) => chunk.text),
              "passage"
            )
        );

        if (!collectionReady) {
          await timed("qdrant.ensure_collection", { vectorSize: vectors[0].length }, () =>
            ensureCollection(vectors[0].length)
          );
          collectionReady = true;
        }

        await timed("qdrant.upsert_batch", { source: file.name, batchSize: batch.length }, () =>
          upsertChunks(batch, vectors)
        );
      }

      documentIds.push(documentId);
      totalChunks += chunks.length;
      logMetric("documents.ingest_file", {
        source: file.name,
        chunks: chunks.length,
        durationMs: Math.round(performance.now() - fileStartedAt)
      });
    }

    clearAnswerCache();
    return NextResponse.json({
      documentIds,
      chunks: totalChunks
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertServerConfig();
    const body = (await request.json()) as { all?: boolean; documentId?: string };

    if (body.all) {
      await timed("documents.delete_all", {}, () => deleteAllIndexedDocuments());
      clearAnswerCache();
      return NextResponse.json({ deleted: "all" });
    }

    const documentId = body.documentId?.trim();

    if (!documentId) {
      return NextResponse.json({ error: "Document ID is required." }, { status: 400 });
    }

    await timed("documents.delete", {}, () => deleteIndexedDocument(documentId));
    clearAnswerCache();
    return NextResponse.json({ documentId });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  return NextResponse.json({ error: message }, { status: 500 });
}
