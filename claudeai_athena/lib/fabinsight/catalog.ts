/**
 * Client-safe metadata for the seven curated dashboards.
 *
 * Split out from `dashboards.ts` so the composer bubbles can render this list
 * synchronously without bundling the SQL or the MCP client into the browser.
 * `dashboards.ts` spreads these entries, so the prompt a bubble sends and the
 * prompt the server matches on are literally the same string.
 *
 * Prompts are verbatim from the Athena FabOrchestrator deck (slides 3–9).
 */

export type DashboardMeta = {
  id: string;
  /** Text on the bubble itself — short enough to keep all seven on one row. */
  label: string;
  /** One-line role, shown in the hover card. */
  blurb: string;
  title: string;
  subtitle: string;
  /** Verbatim deck prompt. */
  prompt: string;
  /** The deck's REQUIREMENTS bullets. */
  requirements: string[];
};

/**
 * The lot and product the two entity-scoped prompts ask about.
 *
 * These are the deck's own values, and they resolve directly against Opcenter
 * SemiDemo — lot `26FHEAEB1E00000` is a real container there and `HL13B5` is
 * the top product by lot count (1,905). They were temporarily swapped for
 * Entegris equivalents while the dashboards pointed at that warehouse, where
 * neither exists.
 *
 * `resolveOrFallback` in dashboards.ts still covers a value going missing.
 */
export const LOT_WANTED = '26FHEAEB1E00000';
export const PRODUCT_WANTED = 'HL13B5';

export const DASHBOARD_META = {
  'factory-operations': {
    id: 'factory-operations',
    label: 'Factory Operations',
    blurb: 'Live factory status and current production',
    title: 'Factory Operations Dashboard',
    subtitle: 'Factory status and current production, live from the floor',
    prompt:
      'Can you create me the dashboard for below - Factory Status - with WIP lot count, Equipment, Yield qty - Current Production - with active lot count, Running Equipment and Cycle Time for each Step.',
    requirements: [
      'Factory Status — WIP, Equipment, Yield',
      'Current Production — Active Lots, Running Tools, Cycle Time',
    ],
  },
  'lot-history': {
    id: 'lot-history',
    label: 'Lot History',
    blurb: 'Step-by-step travel history for one lot',
    title: 'Lot History',
    subtitle: 'Step-to-step route, equipment, timing and quantity',
    prompt: `Can you fetch the lot history for lot id "${LOT_WANTED}" - with from step to step, Tracking equipment name, time Qty, operator name.`,
    requirements: [`Lot History : ${LOT_WANTED}`],
  },
  'process-analytics': {
    id: 'process-analytics',
    label: 'Process Analytics',
    blurb: 'WIP, cycle time and utilisation trends',
    title: 'Process Analytics',
    subtitle: 'WIP trend, cycle-time trend and equipment utilisation',
    prompt:
      'Can you create me the Dashboard for WIP Trend and Cycle time trend and Equipment Utilization for current Week.',
    requirements: ['Yield Trend', 'Cycle Time Trend', 'WIP Trend', 'Equipment Utilization'],
  },
  'maintenance-prediction': {
    id: 'maintenance-prediction',
    label: 'Maintenance',
    blurb: 'Scheduled maintenance and overdue equipment',
    title: 'Maintenance Prediction',
    subtitle: 'Scheduled maintenance, overdue equipment and risk ranking',
    prompt:
      'Can you Create Equipment dashboard Equipment scheduled for Maintenance and Equipment that passing the due.',
    requirements: ['Maintenance Prediction'],
  },
  'bottleneck-prediction': {
    id: 'bottleneck-prediction',
    label: 'Bottleneck Risk',
    blurb: 'Lots at risk against the coming Monday due date',
    title: 'Bottleneck Prediction',
    subtitle: 'Lots held at constrained tools against orders due by the coming Monday',
    prompt: 'Can you give me the bottleneck lot that nearing the expiry date on coming Monday.',
    requirements: ['Bottleneck Prediction'],
  },
  'analytics-dashboard': {
    id: 'analytics-dashboard',
    label: 'Product Analytics',
    blurb: 'Yield, cycle time, WIP heat map and Pareto for one product',
    title: 'Analytics Dashboard',
    subtitle: 'Yield and loss, cycle time, utilisation, WIP heat map and Pareto',
    prompt: `Can you create me the dashboard for below Requirement - yield and Loss Qty for product "${PRODUCT_WANTED}" and key operation - Cycle Time for each Step for this products lots. - Equipment Utilization for this Product. - WIP heat map - Bottleneck analysis - Cycle time distribution - Downtime Pareto`,
    requirements: [
      'Yield trends',
      'Scrap analysis',
      'WIP heat map',
      'Bottleneck analysis',
      'Equipment utilization',
      'Downtime Pareto',
      'Cycle time distribution',
    ],
  },
  'executive-overview': {
    id: 'executive-overview',
    label: 'Executive Overview',
    blurb: 'Fab-wide KPIs: throughput, yield, WIP, OTD',
    title: 'Executive Overview',
    subtitle: 'Throughput, cycle time, yield, WIP, bottleneck area and on-time delivery',
    prompt:
      'Can you create me the dashboard for below Required items - Factory thruput - Average Cycle Time per step. - Yield Analysis. - Active WIP. - Bottleneck Area. - On-Time Delivery',
    requirements: [
      'Factory Throughput',
      'Average Cycle Time',
      'Yield',
      'Active WIP',
      'Bottleneck Area',
      'On-Time Delivery',
    ],
  },
} as const satisfies Record<string, DashboardMeta>;

/** Deck order — slides 3 through 9. */
export const DASHBOARD_ORDER = [
  'factory-operations',
  'lot-history',
  'process-analytics',
  'maintenance-prediction',
  'bottleneck-prediction',
  'analytics-dashboard',
  'executive-overview',
] as const;

export const FAB_BUBBLES: DashboardMeta[] = DASHBOARD_ORDER.map((id) => DASHBOARD_META[id]);

/**
 * Entity values lifted out of the user's wording. A bubble fills the textbox
 * with the deck's own lot/product, but the user is expected to swap them —
 * that is the whole point of filling the box instead of sending.
 */
export type PromptOverrides = { lot?: string; product?: string };

export type CuratedMatch = { meta: DashboardMeta; overrides: PromptOverrides };

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Quoted segments carry the entity ids. Stripping them before comparison is
 * what lets a different lot id still match its dashboard.
 */
const stripEntities = (s: string) => s.replace(/["'‘’“”][^"'‘’“”]*["'‘’“”]/g, ' ');

/** Words shared by most of the seven prompts carry no discriminating signal. */
const STOP = new Set([
  'can', 'you', 'create', 'me', 'the', 'for', 'below', 'with', 'and', 'a', 'an', 'of',
  'to', 'in', 'on', 'is', 'it', 'this', 'that', 'my', 'our', 'give', 'get', 'fetch',
  'please', 'show', 'build', 'make', 'dashboard', 'dashboards', 'requirement',
  'requirements', 'each', 'from', 'by', 'id', 'name', 'kindly', 'need', 'want',
]);

function contentWords(s: string): string[] {
  const seen = new Set<string>();
  for (const w of norm(stripEntities(s)).split(' ')) {
    // Tokens carrying digits are identifiers, not vocabulary. Keeping them
    // would let an unquoted lot id dilute the score of a short prompt.
    if (w.length > 1 && !STOP.has(w) && !/\d/.test(w)) seen.add(w);
  }
  return [...seen];
}

/**
 * Pull the value that follows an anchor word ("lot id", "product"). A quoted
 * value always wins; a bare one must look like an identifier (contains a digit)
 * so that "lot history" does not read as a lot called "history".
 */
function pickEntity(text: string, anchors: RegExp[]): string | undefined {
  for (const anchor of anchors) {
    const m = anchor.exec(text);
    if (!m) continue;
    const from = m.index + m[0].length;
    const rest = text.slice(from, from + 90);

    const quoted = /["'‘’“”]\s*([^"'‘’“”]{2,})\s*["'‘’“”]/.exec(rest);
    if (quoted) return quoted[1].trim();

    for (const tok of rest.match(/[A-Za-z0-9][A-Za-z0-9._-]{2,}/g) ?? []) {
      if (/\d/.test(tok)) return tok;
    }
  }
  return undefined;
}

/** Only the entity a given dashboard actually takes, so the two never cross. */
function overridesFor(id: string, text: string): PromptOverrides {
  if (id === 'lot-history') {
    const lot = pickEntity(text, [/\blot\s*(?:id|no\.?|number)\b/i, /\blot\b/i]);
    return lot && lot !== LOT_WANTED ? { lot } : {};
  }
  if (id === 'analytics-dashboard') {
    const product = pickEntity(text, [/\bproducts?\s*(?:id|code|name)\b/i, /\bproducts?\b/i]);
    return product && product !== PRODUCT_WANTED ? { product } : {};
  }
  return {};
}

/**
 * Match a composer submission to a curated dashboard.
 *
 * Bubbles fill the textbox rather than sending, so by design the text that
 * arrives here has usually been edited — a different lot or product, a dropped
 * clause, extra wording. Exact-match and containment both break under any of
 * that, so scoring is on how much of the deck prompt's distinctive vocabulary
 * survives. Entity ids are stripped from both sides first, then handed back
 * separately as overrides.
 */
export function matchCurated(text: string): CuratedMatch | undefined {
  const t = norm(stripEntities(text));
  if (!t) return undefined;

  const exact = FAB_BUBBLES.find((d) => norm(stripEntities(d.prompt)) === t);
  if (exact) return { meta: exact, overrides: overridesFor(exact.id, text) };

  // Deliberately NOT alias-expanded. Feeding a shortform's expansion into the
  // vocabulary let ordinary questions inherit a deck prompt's own words — "Which
  // EQP has PM scheduled?" gained "equipment" and "maintenance" and matched the
  // Maintenance dashboard, when it should have gone to the normal tools. Only
  // the seven prompts (and edits of them) may produce a dashboard; the alias
  // glossary still reaches the model, it just does not decide routing.
  const saidWords = contentWords(text);
  const said = new Set(saidWords);
  if (!saidWords.length) return undefined;

  let best: DashboardMeta | undefined;
  let bestScore = 0;
  let bestHits = 0;

  for (const d of FAB_BUBBLES) {
    const words = contentWords(d.prompt);
    if (!words.length) continue;
    const hits = words.filter((w) => said.has(w)).length;

    // Coverage catches a full prompt with a clause or two removed. Precision
    // catches the opposite shape — "lot history for <id>" — where the user
    // said little but every word of it points at one dashboard. Either alone
    // misses half the edits a user actually makes.
    const coverage = hits / words.length;
    const precision = hits / saidWords.length;
    const score = Math.max(coverage, precision);

    if (score > bestScore || (score === bestScore && hits > bestHits)) {
      bestScore = score;
      bestHits = hits;
      best = d;
    }
  }

  // 0.55 tolerates dropping two or three clauses; the two-hit floor stops a
  // passing mention of one fab word ("what equipment do we have") from
  // hijacking a dashboard on precision alone.
  if (!best || bestScore < 0.55 || bestHits < 2) return undefined;
  return { meta: best, overrides: overridesFor(best.id, text) };
}

/** Metadata-only form, for the chat route's synchronous pre-flight check. */
export function matchDashboard(text: string): DashboardMeta | undefined {
  return matchCurated(text)?.meta;
}
