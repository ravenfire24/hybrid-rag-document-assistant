export type DocumentChunk = {
  id: string;
  documentId: string;
  source: string;
  category: string;
  page: number;
  chunkIndex: number;
  indexedAt: string;
  text: string;
};

export type RetrievedChunk = DocumentChunk & {
  score?: number;
};

export type IndexedDocument = {
  documentId: string;
  source: string;
  category: string;
  chunkCount: number;
};
