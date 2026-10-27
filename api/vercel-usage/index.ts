import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── CORS helpers ────────────────────────────────────────────────────────────

function setCorsHeaders(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── Types ───────────────────────────────────────────────────────────────────

interface UsageMetric {
  label: string;
  value: string;
  limit: string;
  color: string;
  available: boolean;
}

interface DiagnosticInfo {
  teamIdMasked: string;
  teamName: string | null;
  teamSlug: string | null;
  teamPlan: string | null;
  tokenExists: boolean;
  billingApiStatus: number | null;
  billingApiErrorBody: string | null;
  billingApiUrl: string;
  billingRowCount: number;
  billingServiceNames: string[];
}

interface ApiResponse {
  metrics: UsageMetric[];
  billingPeriod: { start: string | null; end: string | null };
  fetchedAt: string;
  error: string | null;
  debug?: DiagnosticInfo;
}

/** FOCUS v1.3 JSONL row from GET /v1/billing/charges */
interface FocusChargeRow {
  BilledCost?: string;
  BillingCurrency?: string;
  ChargeCategory?: string;
  ChargePeriodEnd?: string;
  ChargePeriodStart?: string;
  ConsumedQuantity?: number | string | null;
  ConsumedUnit?: string | null;
  EffectiveCost?: string;
  PricingCategory?: string;
  PricingCurrency?: string;
  PricingQuantity?: string;
  PricingUnit?: string;
  RegionId?: string;
  RegionName?: string;
  ServiceCategory?: string;
  ServiceName?: string;
  ServiceProviderName?: string;
  Tags?: string;
}

interface TeamApiResponse {
  id?: string;
  name?: string;
  slug?: string;
  billing?: {
    periodStart?: string;
    periodEnd?: string;
    cycle?: { start?: string; end?: string };
    plan?: string;
  };
  plan?: string;
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes.toFixed(2)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatCount(count: number): string {
  if (count < 1000) return String(Math.round(count));
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(2)}h`;
}

// ── Metric configuration ────────────────────────────────────────────────────

type MetricType = 'bytes' | 'count' | 'duration';

interface MetricDef {
  label: string;
  color: string;
  type: MetricType;
  matches: string[];
}

const METRIC_DEFS: MetricDef[] = [
  {
    label: 'Deployment Storage',
    color: '#F36B21',
    type: 'bytes',
    matches: ['deployment-storage', 'deployment storage', 'deploymentstorage'],
  },
  {
    label: 'Edge Requests',
    color: '#3B82F6',
    type: 'count',
    matches: ['edge-requests', 'edge requests', 'edgerequests'],
  },
  {
    label: 'Edge Request CPU Duration',
    color: '#22C55E',
    type: 'duration',
    matches: ['edge-request-cpu-duration', 'edge request cpu duration', 'edgerequestcpuduration', 'edge-cpu', 'edge cpu'],
  },
  {
    label: 'Fast Data Transfer',
    color: '#F59E0B',
    type: 'bytes',
    matches: ['fast-data-transfer', 'fast data transfer', 'fastdatatransfer', 'bandwidth', 'data-transfer'],
  },
  {
    label: 'Fast Origin Transfer',
    color: '#06B6D4',
    type: 'bytes',
    matches: ['fast-origin-transfer', 'fast origin transfer', 'fastorigintransfer', 'origin-transfer'],
  },
  {
    label: 'Private Data Transfer',
    color: '#94A3B8',
    type: 'bytes',
    matches: ['private-data-transfer', 'private data transfer', 'privatedatatransfer'],
  },
  {
    label: 'PrivateLink Data Transfer',
    color: '#94A3B8',
    type: 'bytes',
    matches: ['privatelink-data-transfer', 'privatelink data transfer', 'privatelinkdatatransfer', 'privatelink'],
  },
  {
    label: 'Microfrontends Routing',
    color: '#64748B',
    type: 'count',
    matches: ['microfrontends-routing', 'microfrontends routing', 'microfrontendsrouting', 'microfrontend'],
  },
  {
    label: 'ISR Reads',
    color: '#64748B',
    type: 'count',
    matches: ['isr-reads', 'isr reads', 'isrreads', 'incremental-static-regeneration-reads'],
  },
  {
    label: 'ISR Writes',
    color: '#64748B',
    type: 'count',
    matches: ['isr-writes', 'isr writes', 'isrwrites', 'incremental-static-regeneration-writes'],
  },
];

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_]/g, '-');
}

function matchesService(serviceName: string | undefined, matches: string[]): boolean {
  if (!serviceName) return false;
  const normalized = normalizeName(serviceName);
  return matches.some((m) => {
    const nm = normalizeName(m);
    return normalized === nm || normalized.includes(nm);
  });
}

function parseQuantity(val: number | string | null | undefined): number {
  if (val == null) return 0;
  if (typeof val === 'string') {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? 0 : parsed;
  }
  return val;
}

function formatValue(value: number, type: MetricType): string {
  if (type === 'bytes') return formatBytes(value);
  if (type === 'count') return formatCount(value);
  return formatDuration(value);
}

function maskId(id: string): string {
  if (!id || id.length < 8) return '***';
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

function toBytes(qty: number, unit: string): number {
  const u = unit.toLowerCase().trim();
  if (u === 'gb' || u === 'gigabyte' || u === 'gigabytes') return qty * 1024 * 1024 * 1024;
  if (u === 'mb' || u === 'megabyte' || u === 'megabytes') return qty * 1024 * 1024;
  if (u === 'kb' || u === 'kilobyte' || u === 'kilobytes') return qty * 1024;
  if (u === 'b' || u === 'byte' || u === 'bytes' || u === '') return qty;
  return qty;
}

function parseJsonlRows<T>(bodyText: string): T[] {
  const rows: T[] = [];
  for (const line of bodyText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      // skip unparseable lines
    }
  }
  return rows;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const debugMode = req.query.debug === '1' || req.query.debug === 'true';

  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token) {
    console.error('[vercel-usage] VERCEL_TOKEN environment variable is not set.');
    return res.status(500).json({
      error: 'Server is missing the VERCEL_TOKEN environment variable. Add it in Vercel Project Settings → Environment Variables (server-side only).',
    });
  }
  if (!teamId) {
    console.error('[vercel-usage] VERCEL_TEAM_ID environment variable is not set.');
    return res.status(500).json({
      error: 'Server is missing the VERCEL_TEAM_ID environment variable. Add it in Vercel Project Settings → Environment Variables.',
    });
  }

  const base = 'https://api.vercel.com';
  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Accept-Encoding': 'gzip',
  };

  // ── Step 1: Fetch team info to verify team identity and plan ──────────────
  let billingStart: string | null = null;
  let billingEnd: string | null = null;
  let teamName: string | null = null;
  let teamSlug: string | null = null;
  let teamPlan: string | null = null;

  try {
    const teamRes = await fetch(`${base}/v2/teams/${teamId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (teamRes.ok) {
      const teamData = await teamRes.json() as TeamApiResponse;
      billingStart = teamData.billing?.periodStart ?? teamData.billing?.cycle?.start ?? null;
      billingEnd = teamData.billing?.periodEnd ?? teamData.billing?.cycle?.end ?? null;
      teamName = teamData.name ?? null;
      teamSlug = teamData.slug ?? null;
      teamPlan = teamData.billing?.plan ?? teamData.plan ?? null;
    } else if (teamRes.status === 401 || teamRes.status === 403) {
      const msg = teamRes.status === 401
        ? 'Unauthorized — the VERCEL_TOKEN is missing, invalid, or expired.'
        : 'Forbidden — the VERCEL_TOKEN does not have sufficient permissions for this team.';
      console.error(`[vercel-usage] /v2/teams/${teamId} returned ${teamRes.status}: ${msg}`);
      return res.status(401).json({ error: msg });
    } else {
      console.warn(`[vercel-usage] /v2/teams/${teamId} returned ${teamRes.status} — falling back to 30-day window.`);
    }
  } catch (err) {
    console.warn(`[vercel-usage] Failed to fetch team info: ${err instanceof Error ? err.message : String(err)} — falling back to 30-day window.`);
  }

  const now = new Date();
  const end = billingEnd ?? now.toISOString();
  const start = billingStart ?? (() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  })();

  // ── Step 2: Call /v1/billing/charges (without projectId) ──────────────────
  // Per official Vercel docs, this endpoint accepts: teamId, from, to, slug.
  // projectId is NOT a documented parameter.
  const billingParams = new URLSearchParams({ teamId, from: start, to: end });
  const billingUrl = `${base}/v1/billing/charges?${billingParams.toString()}`;

  let billingRows: FocusChargeRow[] = [];
  let billingApiStatus: number | null = null;
  let billingApiErrorBody: string | null = null;

  try {
    const billingRes = await fetch(billingUrl, { headers: authHeaders });
    billingApiStatus = billingRes.status;

    if (!billingRes.ok) {
      const errBody = await billingRes.text().catch(() => '');
      billingApiErrorBody = errBody.slice(0, 300) || null;
      console.warn(`[vercel-usage] /v1/billing/charges returned ${billingRes.status}: ${errBody.slice(0, 200)}`);
    } else {
      const bodyText = await billingRes.text();
      billingRows = parseJsonlRows<FocusChargeRow>(bodyText);
      console.log(`[vercel-usage] /v1/billing/charges returned ${billingRows.length} rows, status ${billingApiStatus}`);
    }
  } catch (err) {
    billingApiErrorBody = err instanceof Error ? err.message : String(err);
    console.error(`[vercel-usage] /v1/billing/charges fetch error: ${billingApiErrorBody}`);
  }

  // ── Step 3: Log diagnostics (safe — no secrets) ───────────────────────────
  const billingServiceNames = [...new Set(
    billingRows.map((r) => r.ServiceName || '').filter(Boolean)
  )].sort();

  console.log('[vercel-usage] === DIAGNOSTIC SUMMARY ===');
  console.log(`[vercel-usage] Team: ${maskId(teamId)} name="${teamName}" slug="${teamSlug}" plan="${teamPlan}" tokenExists=${!!token}`);
  console.log(`[vercel-usage] /v1/billing/charges: status=${billingApiStatus} rows=${billingRows.length} error="${billingApiErrorBody?.slice(0, 100) ?? 'none'}"`);
  if (billingRows.length > 0) {
    console.log(`[vercel-usage] ServiceNames: ${JSON.stringify(billingServiceNames)}`);
  }
  console.log('[vercel-usage] === END DIAGNOSTIC ===');

  // ── Step 4: Build metrics from billing data ───────────────────────────────
  const isHobbyPlan = teamPlan?.toLowerCase() === 'hobby';
  const isCostsNotFound = billingApiStatus === 404 && billingApiErrorBody?.includes('costs_not_found') === true;

  let apiError: string | null = null;

  if (billingRows.length === 0) {
    if (isCostsNotFound) {
      if (isHobbyPlan) {
        apiError = 'The Vercel Billing Charges API returned "costs_not_found" for this team. This team is on the Hobby (free) plan. The Billing API only returns charge data when there are billable charges — Hobby teams have no billable charges, so the API returns no data. The Vercel Dashboard shows usage metrics internally, but no supported public API exposes those metrics for Hobby teams.';
      } else {
        apiError = 'The Vercel Billing Charges API returned "costs_not_found". This may mean the team has no billable charges in the current period, or the billing API is not available for this team/plan.';
      }
    } else if (billingApiErrorBody) {
      apiError = `Billing API error (HTTP ${billingApiStatus}): ${billingApiErrorBody.slice(0, 200)}`;
    } else {
      apiError = 'The Billing API returned no charge rows. See server logs for diagnostic information.';
    }
  }

  const metrics: UsageMetric[] = METRIC_DEFS.map((def) => {
    const billingMatches = billingRows.filter((r) => matchesService(r.ServiceName, def.matches));

    if (billingMatches.length > 0) {
      const total = billingMatches.reduce((sum, row) => {
        const qty = parseQuantity(row.ConsumedQuantity);
        const unit = (row.ConsumedUnit || '').toLowerCase();

        if (def.type === 'bytes') return sum + toBytes(qty, unit);
        if (def.type === 'duration') {
          const ms = unit.includes('ms') ? qty : qty * 1000;
          return sum + ms;
        }
        return sum + qty;
      }, 0);

      return {
        label: def.label,
        value: formatValue(total, def.type),
        limit: '—',
        color: def.color,
        available: true,
      };
    }

    return {
      label: def.label,
      value: 'N/A',
      limit: '—',
      color: def.color,
      available: false,
    };
  });

  // ── Step 5: Return response ───────────────────────────────────────────────
  const response: ApiResponse = {
    metrics,
    billingPeriod: { start: billingStart, end: billingEnd },
    fetchedAt: new Date().toISOString(),
    error: apiError,
  };

  const allNA = metrics.every((m) => !m.available);
  if (debugMode || allNA) {
    response.debug = {
      teamIdMasked: maskId(teamId),
      teamName,
      teamSlug,
      teamPlan,
      tokenExists: !!token,
      billingApiStatus,
      billingApiErrorBody,
      billingApiUrl: billingUrl.replace(token, '<token>'),
      billingRowCount: billingRows.length,
      billingServiceNames,
    };
  }

  return res.status(200).json(response);
}
