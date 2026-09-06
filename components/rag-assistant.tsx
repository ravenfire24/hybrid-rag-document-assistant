"use client";

import { FileText, RefreshCw, Send, Trash2, UploadCloud, X } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";

type IndexedDocument = {
  documentId: string;
  source: string;
  category: string;
  chunkCount: number;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type UploadResult = {
  documentIds: string[];
  chunks: number;
};

export function RagAssistant() {
  const [files, setFiles] = useState<File[]>([]);
  const [documents, setDocuments] = useState<IndexedDocument[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");

  async function loadDocuments() {
    const response = await fetch("/api/documents", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Could not load documents.");
    }
    setDocuments(payload.documents);
    setSelectedIds((current) => {
      const available = new Set<string>(
        payload.documents.map((item: IndexedDocument) => item.documentId)
      );
      const kept = current.filter((id) => available.has(id));
      return kept.length ? kept : payload.documents.map((item: IndexedDocument) => item.documentId);
    });
  }

  useEffect(() => {
    loadDocuments().catch((loadError: Error) => setError(loadError.message));
  }, []);

  const selectedCount = useMemo(
    () => selectedIds.filter((id) => documents.some((doc) => doc.documentId === id)).length,
    [documents, selectedIds]
  );
  const activeDocumentIds = useMemo(() => {
    const availableIds = documents.map((document) => document.documentId);
    const selectedAvailableIds = selectedIds.filter((id) => availableIds.includes(id));
    return selectedAvailableIds.length ? selectedAvailableIds : availableIds;
  }, [documents, selectedIds]);

  async function uploadFiles() {
    if (!files.length) {
      return;
    }

    setBusy(true);
    setError("");
    setStatus("Uploading");
    setUploadProgress(1);

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const payload = await uploadWithProgress(formData);

      setFiles([]);
      setFileInputKey((current) => current + 1);
      setSelectedIds(payload.documentIds);
      await loadDocuments();
      setUploadProgress(100);
      setStatus("Ready");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
      setStatus("Ready");
    } finally {
      setBusy(false);
      window.setTimeout(() => setUploadProgress(null), 700);
    }
  }

  function uploadWithProgress(formData: FormData) {
    return new Promise<UploadResult>((resolve, reject) => {
      const request = new XMLHttpRequest();

      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setUploadProgress(Math.max(1, Math.min(85, Math.round((event.loaded / event.total) * 85))));
        }
      };

      request.upload.onload = () => {
        setUploadProgress(90);
        setStatus("Indexing");
      };

      request.onload = () => {
        let payload: { error?: string } & Partial<UploadResult> = {};
        try {
          payload = JSON.parse(request.responseText || "{}");
        } catch {
          reject(new Error("Upload failed with an invalid server response."));
          return;
        }

        if (request.status >= 200 && request.status < 300 && payload.documentIds && typeof payload.chunks === "number") {
          resolve({
            documentIds: payload.documentIds,
            chunks: payload.chunks
          });
          return;
        }

        reject(new Error(payload.error ?? "Upload failed."));
      };

      request.onerror = () => reject(new Error("Upload failed."));
      request.open("POST", "/api/documents");
      request.send(formData);
    });
  }

  async function askQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || busy) {
      return;
    }

    if (activeDocumentIds.length === 0) {
      setError("Upload a document before asking a question.");
      setStatus("Ready");
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed
    };

    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setBusy(true);
    setError("");
    setStatus("Thinking");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          documentIds: activeDocumentIds
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Question failed.");
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: payload.answer
        }
      ]);
      setStatus("Answered");
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Question failed.");
      setStatus("Ready");
    } finally {
      setBusy(false);
    }
  }

  function toggleDocument(documentId: string) {
    setSelectedIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId]
    );
  }

  function removePendingFile(indexToRemove: number) {
    setFiles((current) => current.filter((_, index) => index !== indexToRemove));
    setFileInputKey((current) => current + 1);
  }

  async function removeIndexedDocument(documentId: string) {
    setBusy(true);
    setError("");
    setStatus("Removing");

    try {
      const response = await fetch("/api/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Remove failed.");
      }

      setSelectedIds((current) => current.filter((id) => id !== documentId));
      setMessages([]);
      await loadDocuments();
      setStatus("Removed document");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Remove failed.");
      setStatus("Ready");
    } finally {
      setBusy(false);
    }
  }

  async function removeAllIndexedDocuments() {
    if (!documents.length) {
      return;
    }

    setBusy(true);
    setError("");
    setStatus("Clearing");

    try {
      const response = await fetch("/api/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Clear failed.");
      }

      setDocuments([]);
      setSelectedIds([]);
      setMessages([]);
      setStatus("Cleared documents");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Clear failed.");
      setStatus("Ready");
    } finally {
      setBusy(false);
    }
  }

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div>
            <h1>Document QA</h1>
          </div>
        </div>

        <div className="upload-zone">
          <UploadCloud aria-hidden size={22} />
          <input
            key={fileInputKey}
            className="file-input"
            type="file"
            accept=".pdf,.txt,.docx"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          {files.length > 0 ? (
            <div className="pending-files">
              {files.map((file, index) => (
                <div className="pending-file" key={`${file.name}-${file.size}-${index}`}>
                  <span>{file.name}</span>
                  <button
                    aria-label={`Remove ${file.name}`}
                    className="file-remove"
                    disabled={busy}
                    onClick={() => removePendingFile(index)}
                    title="Remove file"
                    type="button"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <button className="primary-btn" disabled={busy || !files.length} onClick={uploadFiles}>
            <UploadCloud size={18} />
            Upload
          </button>
          {uploadProgress !== null ? (
            <div className="progress-track" aria-label="Upload progress">
              <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
            </div>
          ) : null}
          {files.length > 0 ? (
            <p className="hint">
              {files.length} file{files.length === 1 ? "" : "s"} selected
            </p>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
        </div>

        <div className="section-header">
          <p className="section-title">Documents</p>
          <button
            aria-label="Remove all documents"
            className="file-remove"
            disabled={busy || documents.length === 0}
            onClick={removeAllIndexedDocuments}
            title="Remove all documents"
            type="button"
          >
            <Trash2 size={16} />
          </button>
        </div>
        <div className="doc-list">
          {documents.map((document) => (
            <div className="doc-row" key={document.documentId}>
              <label className="doc-select">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(document.documentId)}
                  onChange={() => toggleDocument(document.documentId)}
                />
                <FileText aria-hidden size={18} />
                <span>
                  <p className="doc-name">{document.source}</p>
                  <p className="doc-meta">
                    {document.category.toUpperCase()} - {document.chunkCount} chunks
                  </p>
                </span>
              </label>
              <button
                aria-label={`Remove ${document.source}`}
                className="file-remove"
                disabled={busy}
                onClick={() => removeIndexedDocument(document.documentId)}
                title="Remove document"
                type="button"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="main">
        <div className="topbar">
          <div>
            <h2>Ask Your Documents</h2>
            <p>
              {selectedCount} selected document{selectedCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="status">{busy ? <RefreshCw size={14} /> : null} {status}</div>
        </div>

        <div className="chat">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div>
                <h3>Upload a document to begin</h3>
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <p className="message-role">{message.role}</p>
                  <p className="message-text">{message.content}</p>
                </article>
              ))}
            </div>
          )}
        </div>

        <form className="composer" onSubmit={askQuestion}>
          <textarea
            aria-label="Question"
            placeholder={documents.length > 0 ? "Ask a question..." : "Upload a document first..."}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={handleQuestionKeyDown}
          />
          <button
            className="icon-btn"
            disabled={busy || !question.trim() || documents.length === 0}
            title="Send"
            type="submit"
          >
            <Send size={20} />
          </button>
        </form>
      </section>
    </main>
  );
}
