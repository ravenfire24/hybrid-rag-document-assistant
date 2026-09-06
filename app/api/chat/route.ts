import { NextRequest, NextResponse } from "next/server";
import { assertServerConfig } from "@/lib/config";
import { logMetric, timed } from "@/lib/metrics";
import { answerQuestion, embedTexts, rerank } from "@/lib/nvidia";
import { getCachedAnswer, setCachedAnswer } from "@/lib/rag-cache";
import { listIndexedDocuments, searchChunks } from "@/lib/qdrant";

const RERANKED_CANDIDATES = 5;
const ANSWER_CHUNKS = 3;

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatRequest = {
  question?: string;
  documentIds?: string[];
};

export async function POST(request: NextRequest) {
  try {
    assertServerConfig();
    const body = (await request.json()) as ChatRequest;
    const question = body.question?.trim();
    const documentIds = Array.isArray(body.documentIds) ? body.documentIds : [];

    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const indexedDocuments = await timed("chat.list_documents", {}, () => listIndexedDocuments());
    if (!indexedDocuments.length) {
      return NextResponse.json({
        answer: "No documents are indexed yet. Upload a PDF, TXT, or DOCX file first, then ask your question."
      });
    }

    const indexedDocumentIds = indexedDocuments.map((document) => document.documentId);
    const indexedDocumentSet = new Set(indexedDocumentIds);
    const activeDocumentIds = documentIds.filter((id) => indexedDocumentSet.has(id));
    const searchDocumentIds = activeDocumentIds.length ? activeDocumentIds : indexedDocumentIds;

    const cached = getCachedAnswer(question, searchDocumentIds);
    if (cached) {
      logMetric("chat.answer_cache_hit", {
        selectedDocuments: searchDocumentIds.length
      });
      return NextResponse.json({ answer: cached.answer, cached: true });
    }

    const [queryVector] = await timed("chat.embed_query", {}, () => embedTexts([question], "query"));
    const candidates = await timed("chat.retrieve", { selectedDocuments: searchDocumentIds.length, topK: 30 }, () =>
      searchChunks(queryVector, searchDocumentIds, 30)
    );

    if (!candidates.length) {
      return NextResponse.json({
        answer: "I don't know"
      });
    }

    let reranked = candidates.slice(0, RERANKED_CANDIDATES);
    try {
      reranked = await timed("chat.rerank", { candidates: candidates.length, topK: RERANKED_CANDIDATES }, () =>
        rerank(question, candidates, RERANKED_CANDIDATES)
      );
    } catch (rerankError) {
      console.warn(
        "NVIDIA rerank failed; falling back to Qdrant vector order:",
        rerankError instanceof Error ? rerankError.message : rerankError
      );
    }

    const finalChunks = reranked.slice(0, ANSWER_CHUNKS);
    const answer = await timed("chat.generate", { chunks: finalChunks.length }, () =>
      answerQuestion(question, finalChunks)
    );
    setCachedAnswer(question, searchDocumentIds, answer);

    return NextResponse.json({ answer, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
