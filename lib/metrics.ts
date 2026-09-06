type MetricFields = Record<string, boolean | number | string | undefined>;

export function logMetric(event: string, fields: MetricFields = {}) {
  console.log(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...fields
    })
  );
}

export async function timed<T>(event: string, fields: MetricFields, work: () => Promise<T>) {
  const startedAt = performance.now();

  try {
    const result = await work();
    logMetric(event, {
      ...fields,
      ok: true,
      durationMs: Math.round(performance.now() - startedAt)
    });
    return result;
  } catch (error) {
    logMetric(event, {
      ...fields,
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : "Unknown error"
    });
    throw error;
  }
}
