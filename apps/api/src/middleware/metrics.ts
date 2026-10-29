import type { RequestHandler } from 'express';

/**
 * Minimal in-process HTTP metrics rendered in the Prometheus text format by GET /api/metrics.
 * Requests are labelled by method, matched route pattern (never the raw URL, to bound
 * cardinality) and status class.
 */

interface Series {
  count: number;
  durationSum: number;
}

const series = new Map<string, Series>();
const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const buckets = new Map<string, number[]>();
const startedAt = Date.now();

function labelsFor(method: string, route: string, status: number): string {
  return `method="${method}",route="${route.replace(/"/g, '')}",status="${Math.floor(status / 100)}xx"`;
}

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : 'unmatched';
    const key = labelsFor(req.method, route, res.statusCode);
    const s = series.get(key) ?? { count: 0, durationSum: 0 };
    s.count += 1;
    s.durationSum += seconds;
    series.set(key, s);
    const counts = buckets.get(key) ?? BUCKETS.map(() => 0);
    BUCKETS.forEach((b, i) => {
      if (seconds <= b) counts[i] = (counts[i] ?? 0) + 1;
    });
    buckets.set(key, counts);
  });
  next();
};

export function renderMetrics(extra: Record<string, number> = {}): string {
  const lines: string[] = [
    '# HELP nexus_http_requests_total HTTP requests by method, route and status class.',
    '# TYPE nexus_http_requests_total counter',
  ];
  for (const [labels, s] of series) lines.push(`nexus_http_requests_total{${labels}} ${s.count}`);

  lines.push('# HELP nexus_http_request_duration_seconds HTTP request duration.', '# TYPE nexus_http_request_duration_seconds histogram');
  for (const [labels, s] of series) {
    const counts = buckets.get(labels) ?? [];
    BUCKETS.forEach((b, i) => lines.push(`nexus_http_request_duration_seconds_bucket{${labels},le="${b}"} ${counts[i] ?? 0}`));
    lines.push(`nexus_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${s.count}`);
    lines.push(`nexus_http_request_duration_seconds_sum{${labels}} ${s.durationSum.toFixed(6)}`);
    lines.push(`nexus_http_request_duration_seconds_count{${labels}} ${s.count}`);
  }

  const mem = process.memoryUsage();
  const gauges: Record<string, number> = {
    nexus_process_uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    nexus_process_resident_memory_bytes: mem.rss,
    nexus_process_heap_used_bytes: mem.heapUsed,
    ...extra,
  };
  for (const [name, value] of Object.entries(gauges)) lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
  return `${lines.join('\n')}\n`;
}

/** Test helper */
export function resetMetrics(): void {
  series.clear();
  buckets.clear();
}
