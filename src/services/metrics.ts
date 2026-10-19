const bounds = [5, 10, 25, 50, 100, 200, 500, 1000, 25000, Infinity];
interface Histogram { count: number; sum: number; buckets: number[]; errors: number }
export class Metrics {
  private values = new Map<string, Histogram>();
  record(route: string, method: string, elapsedMs: number, status: number) {
    // Route templates only: never put URLs, query parameters or user values in telemetry.
    const key = `${method} ${route}`;
    const h = this.values.get(key) ?? { count: 0, sum: 0, buckets: bounds.map(() => 0), errors: 0 };
    h.count++; h.sum += elapsedMs; if (status >= 400) h.errors++;
    bounds.forEach((b, i) => { if (elapsedMs <= b) h.buckets[i]!++; });
    this.values.set(key, h);
  }
  snapshot() {
    return { unit: 'milliseconds', scope: 'this_process_since_start',
      routes: [...this.values].map(([route, h]) => ({ route, count: h.count,
        errors: h.errors, sumMs: h.sum, averageMs: h.sum / h.count,
        buckets: bounds.map((b, i) => ({ le: Number.isFinite(b) ? b : '+Inf', count: h.buckets[i] })),
      })) };
  }
}
