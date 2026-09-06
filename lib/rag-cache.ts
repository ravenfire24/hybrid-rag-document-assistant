import { createHash } from "crypto";
import { TtlCache } from "@/lib/cache";

type AnswerCacheValue = {
  answer: string;
};

const answerCache = new TtlCache<AnswerCacheValue>(10 * 60 * 1000, 300);

export function getCachedAnswer(question: string, documentIds: string[]) {
  return answerCache.get(answerCacheKey(question, documentIds));
}

export function setCachedAnswer(question: string, documentIds: string[], answer: string) {
  answerCache.set(answerCacheKey(question, documentIds), { answer });
}

export function clearAnswerCache() {
  answerCache.clear();
}

function answerCacheKey(question: string, documentIds: string[]) {
  const input = JSON.stringify({
    question: question.trim().toLowerCase(),
    documentIds: [...documentIds].sort()
  });

  return createHash("sha256").update(input).digest("hex");
}
