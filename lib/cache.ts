type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class TtlCache<T> {
  private values = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize = 200
  ) {}

  get(key: string) {
    const entry = this.values.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.values.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T) {
    if (this.values.size >= this.maxSize) {
      const oldestKey = this.values.keys().next().value;
      if (oldestKey) {
        this.values.delete(oldestKey);
      }
    }

    this.values.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs
    });
  }

  deletePrefix(prefix: string) {
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) {
        this.values.delete(key);
      }
    }
  }

  clear() {
    this.values.clear();
  }
}
