import { createHash } from "crypto";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import type { DocumentChunk } from "@/lib/types";

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 180;

export async function extractText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "txt") {
    return buffer.toString("utf8");
  }

  if (extension === "pdf") {
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }

  if (extension === "docx") {
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value;
  }

  throw new Error(`Unsupported file type: ${extension || "unknown"}`);
}

export async function fileHash(file: File) {
  return createHash("sha256")
    .update(Buffer.from(await file.arrayBuffer()))
    .digest("hex");
}

export function splitIntoChunks(input: {
  text: string;
  documentId: string;
  source: string;
  category: string;
}) {
  const cleaned = input.text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!cleaned) {
    return [];
  }

  const chunks: DocumentChunk[] = [];
  let cursor = 0;
  let chunkIndex = 0;
  const indexedAt = new Date().toISOString();

  while (cursor < cleaned.length) {
    let end = Math.min(cursor + CHUNK_SIZE, cleaned.length);
    const lastParagraph = cleaned.lastIndexOf("\n\n", end);
    const lastSentence = cleaned.lastIndexOf(". ", end);
    const boundary = Math.max(lastParagraph, lastSentence);

    if (boundary > cursor + CHUNK_SIZE * 0.55) {
      end = boundary + 1;
    }

    const text = cleaned.slice(cursor, end).trim();
    if (text) {
      chunks.push({
        id: stablePointId(`${input.documentId}:${chunkIndex}:${text}`),
        documentId: input.documentId,
        source: input.source,
        category: input.category,
        page: 0,
        chunkIndex,
        indexedAt,
        text
      });
      chunkIndex += 1;
    }

    if (end >= cleaned.length) {
      break;
    }
    cursor = Math.max(0, end - CHUNK_OVERLAP);
  }

  return chunks;
}

function stablePointId(value: string) {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}
