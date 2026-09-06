export const config = {
  nvidiaApiKey: process.env.NVIDIA_API_KEY ?? "",
  nvidiaChatBaseUrl: process.env.NVIDIA_CHAT_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  nvidiaEmbedBaseUrl: process.env.NVIDIA_EMBED_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  nvidiaRerankUrl:
    process.env.NVIDIA_RERANK_URL ??
    "https://ai.api.nvidia.com/v1/retrieval/nvidia/llama-nemotron-rerank-vl-1b-v2/reranking",
  nvidiaChatModel: process.env.NVIDIA_CHAT_MODEL ?? "meta/llama-3.2-11b-vision-instruct",
  nvidiaEmbedModel: process.env.NVIDIA_EMBED_MODEL ?? "nvidia/nemotron-3-embed-1b",
  nvidiaRerankModel: process.env.NVIDIA_RERANK_MODEL ?? "nvidia/llama-nemotron-rerank-vl-1b-v2",
  qdrantUrl: process.env.QDRANT_URL ?? "",
  qdrantApiKey: process.env.QDRANT_API_KEY ?? "",
  qdrantCollection: process.env.QDRANT_COLLECTION ?? "documents"
};

export function assertServerConfig() {
  const missing = [
    ["NVIDIA_API_KEY", config.nvidiaApiKey],
    ["QDRANT_API_KEY", config.qdrantApiKey],
    ["QDRANT_URL", config.qdrantUrl]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(`Missing required environment variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
  }
}
