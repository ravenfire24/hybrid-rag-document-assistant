# Document QA

Document QA is a full-stack RAG application for asking questions about uploaded documents. Users upload PDF, TXT, or DOCX files, the app indexes them in Qdrant Cloud, and the chatbot answers questions using only the retrieved document context.

## What It Does

- Upload PDF, TXT, and DOCX files
- Extract document text automatically
- Split documents into searchable chunks
- Generate embeddings in batches
- Store vectors and metadata in Qdrant Cloud
- Retrieve a small top-k candidate set for each question
- Rerank retrieved chunks before answering
- Generate direct answers with an NVIDIA-hosted LLM
- Remove individual documents or clear all indexed documents
- Cache repeated embeddings and common questions
- Log pipeline timing for monitoring and debugging

## Tech Used

- **Next.js**: application framework and API routes
- **React**: upload and chat interface
- **TypeScript**: typed application code
- **Vercel**: deployment target
- **Qdrant Cloud**: persistent vector database
- **NVIDIA NIM APIs**: embeddings, reranking, and LLM inference
- **pdf-parse**: PDF text extraction
- **mammoth**: DOCX text extraction
- **lucide-react**: interface icons

## Architecture

```text
User Browser
  -> Next.js UI
  -> Next.js API routes
  -> NVIDIA embeddings / reranker / LLM
  -> Qdrant Cloud vector database
```

The app separates ingestion from querying:

- `POST /api/documents` handles document upload, text extraction, chunking, embedding, and Qdrant storage.
- `GET /api/documents` lists indexed documents.
- `DELETE /api/documents` removes one document or clears the collection.
- `POST /api/chat` handles question embedding, Qdrant retrieval, reranking, and answer generation.

## Pipeline

```text
PDF / TXT / DOCX
  -> text extraction
  -> chunking
  -> NVIDIA embedding model
  -> Qdrant Cloud
  -> top-k retrieval
  -> NVIDIA reranker
  -> top 3 chunks
  -> meta/llama-3.2-11b-vision-instruct
  -> direct answer
```

The retrieval path searches the full Qdrant collection but only sends a small candidate set to the reranker. The final answer model receives only the highest-ranked chunks, which keeps inference focused and efficient.

## Project Structure

```text
app/
  api/
    chat/route.ts        # question answering endpoint
    documents/route.ts   # upload, list, delete, and reset endpoint
  globals.css            # app styling
  layout.tsx             # root layout
  page.tsx               # main page

components/
  rag-assistant.tsx      # document upload, document list, and chat UI

lib/
  cache.ts               # TTL cache helper
  config.ts              # server-side environment config
  metrics.ts             # structured timing logs
  nvidia.ts              # NVIDIA API calls
  qdrant.ts              # Qdrant API calls
  rag-cache.ts           # answer cache
  text.ts                # extraction and chunking
  types.ts               # shared types
```

## How To Run It

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the app:

```text
http://localhost:3000
```
## Benchmarks And Evidence

Use the benchmark script when you want to support resume or portfolio claims with reproducible numbers. The app should only claim dataset scale, chunk scale, query accuracy, or load performance after these reports exist.

Count the sample dataset files:

```bash
npm run benchmark:dataset -- --dataset data
```

Check the live Qdrant collection point count and indexed document count:

```bash
npm run benchmark:qdrant
```

Run a query test set against the local app:

```bash
npm run dev
npm run benchmark:queries -- --queries benchmarks/queries.jsonl --api http://localhost:3000
```

Run a simple load test:

```bash
npm run benchmark:load -- --queries benchmarks/queries.jsonl --api http://localhost:3000 --concurrency 5 --repeats 3
```

Reports are written to the `benchmarks/` folder as JSON files. Keep the important reports privately if you want proof for claims like:

- Sample dataset size, such as total files and PDF count
- Qdrant point count, which represents stored document chunks
- Test query count and pass/fail results
- Load test latency, concurrency, cache hits, and error rate

To run the included example queries, duplicate `benchmarks/queries.example.jsonl` to `benchmarks/queries.jsonl` and edit it for your own documents. For a 100-query validation claim, `benchmarks/queries.jsonl` should contain at least 100 real document questions and the generated report should show the actual request count and error count.

Do not claim numbers such as 500 PDFs, 500,000 chunks, or 100 tested queries unless your private benchmark reports show those exact results.
