import type { Principal } from "../auth.js";
import type { Product, ProductCategory } from "../schemas/product.js";
import type { Store } from "../store.js";
import { recordAudit } from "./audit.js";
import { formatEur, type AgentPolicy, type GuardrailCheck } from "./permissions.js";
import { CATEGORY_FI, fiEur, fiList, fiPerson, type Finnish } from "../i18n.js";

/**
 * Earned autonomy. Today a person signs off every order; in an agentic setup
 * that sign-off should stay until the agent has shown it can be trusted. So an
 * agent starts supervised in every product category and earns the right to
 * order alone, one category at a time, from the buyer's own decisions:
 *
 * - Each approval of the agent's quote in a category counts toward autonomy.
 * - After `approvalsToEarn` approvals in a row, the agent may order alone in
 *   that category, up to the largest total the buyer has approved there and
 *   never above its policy limit.
 * - A rejection, or an attempt the server refused or blocked, resets the run:
 *   trust is lost faster than it is gained.
 * - The buyer can grant or revoke a category at any time. Agents cannot.
 *
 * Every change is in the audit history, so anyone can see why an agent may or
 * may not act alone.
 */

export interface AutonomySettings {
  /** "earned": supervised until earned per category. "limits": the agent orders alone within its other rules. */
  mode: "earned" | "limits";
  /** Approvals in a row that earn a category. */
  approvalsToEarn: number;
}

export type TrackEvent = "seeded" | "approved" | "rejected" | "refused" | "granted" | "revoked";

export interface TrackRecordEvent {
  at: string;
  event: TrackEvent;
  quoteId?: string;
  amountEurCents?: number;
  note: string;
}

export interface CategoryRecord {
  category: ProductCategory;
  /** Approvals in a row since the last reset. */
  approvalsInRow: number;
  /** The largest total in this category the buyer approved in the current run. */
  largestApprovedEurCents: number;
  totals: { approvals: number; rejections: number; refusals: number };
  /** Set when the buyer granted the category directly, with the limit granted. */
  grant?: { capEurCents: number; at: string; by: string };
  lastReset?: { at: string; reason: string };
  /** The most recent events, newest first. */
  history: TrackRecordEvent[];
}

export type AutonomyStatus = "earned" | "supervised";

export interface CategoryAutonomy {
  category: ProductCategory;
  status: AutonomyStatus;
  /** How much the agent may order alone in this category, when earned. */
  capEurCents: number | null;
  approvalsInRow: number;
  approvalsToEarn: number;
  /** "approvals" when earned from the buyer's decisions, "buyer" when granted directly. */
  earnedBy: "approvals" | "buyer" | null;
  totals: CategoryRecord["totals"];
  lastReset?: CategoryRecord["lastReset"];
  history: TrackRecordEvent[];
  /** One sentence for the buyer. */
  explanation: string;
}

const HISTORY_LENGTH = 12;

export type TrackRecords = Map<string, Map<ProductCategory, CategoryRecord>>;

function emptyRecord(category: ProductCategory): CategoryRecord {
  return { category, approvalsInRow: 0, largestApprovedEurCents: 0, totals: { approvals: 0, rejections: 0, refusals: 0 }, history: [] };
}

export function recordFor(records: TrackRecords, agentId: string, category: ProductCategory): CategoryRecord {
  let agent = records.get(agentId);
  if (!agent) records.set(agentId, (agent = new Map()));
  let record = agent.get(category);
  if (!record) agent.set(category, (record = emptyRecord(category)));
  return record;
}

function remember(record: CategoryRecord, event: TrackRecordEvent) {
  record.history.unshift(event);
  record.history.length = Math.min(record.history.length, HISTORY_LENGTH);
}

/** The category's status under the agent's policy. */
export function categoryAutonomy(policy: AgentPolicy, record: CategoryRecord): CategoryAutonomy {
  const { approvalsToEarn } = policy.autonomy;
  const earnedByApprovals = record.approvalsInRow >= approvalsToEarn && record.largestApprovedEurCents > 0;
  const status: AutonomyStatus = record.grant || earnedByApprovals ? "earned" : "supervised";
  const capEurCents =
    status === "earned"
      ? Math.min(policy.spendingLimitEurCents, Math.max(record.grant?.capEurCents ?? 0, earnedByApprovals ? record.largestApprovedEurCents : 0))
      : null;
  const earnedBy = status === "supervised" ? null : record.grant ? "buyer" : "approvals";
  const remaining = Math.max(0, approvalsToEarn - record.approvalsInRow);
  const explanation =
    status === "earned"
      ? earnedBy === "buyer"
        ? `The buyer granted autonomy in ${record.category} up to ${formatEur(capEurCents!)}.`
        : `Earned: the buyer approved ${record.approvalsInRow} ${record.category} quotes in a row, so the agent may order ${record.category} alone up to ${formatEur(capEurCents!)}, the largest total approved.`
      : `Supervised: ${remaining} more approval${remaining === 1 ? "" : "s"} in a row needed before the agent may order ${record.category} alone.`;
  return {
    category: record.category,
    status,
    capEurCents,
    approvalsInRow: record.approvalsInRow,
    approvalsToEarn,
    earnedBy,
    totals: { ...record.totals },
    ...(record.lastReset ? { lastReset: { ...record.lastReset } } : {}),
    history: record.history.map((event) => ({ ...event })),
    explanation,
  };
}

/** Every category the agent has a record in, plus any it is asked about, earned first. */
export function agentAutonomy(store: Store, policy: AgentPolicy): CategoryAutonomy[] {
  const records = store.trackRecords.get(policy.agentId) ?? new Map<ProductCategory, CategoryRecord>();
  return [...records.values()]
    .map((record) => categoryAutonomy(policy, record))
    .sort((a, b) => (a.status === b.status ? a.category.localeCompare(b.category) : a.status === "earned" ? -1 : 1));
}

/** Each category's share of a quote's total, from its products and their line totals. */
export function totalsByCategory(products: Product[], lineTotalsEurCents: number[]): Map<ProductCategory, number> {
  const totals = new Map<ProductCategory, number>();
  products.forEach((product, index) => totals.set(product.category, (totals.get(product.category) ?? 0) + (lineTotalsEurCents[index] ?? 0)));
  return totals;
}

/**
 * The earned-autonomy rule for one quote: passed when every category in it is
 * earned and within its earned limit, otherwise the buyer must approve.
 */
export function earnedAutonomyCheck(store: Store, policy: AgentPolicy, byCategory: Map<ProductCategory, number>): GuardrailCheck | undefined {
  if (policy.autonomy.mode !== "earned") return undefined;
  const supervised: string[] = [];
  const overCap: string[] = [];
  const earned: string[] = [];
  const supervisedFi: string[] = [];
  const overCapFi: string[] = [];
  const earnedFi: string[] = [];
  for (const [category, amount] of byCategory) {
    const status = categoryAutonomy(policy, recordFor(store.trackRecords, policy.agentId, category));
    if (status.status === "supervised") {
      const remaining = status.approvalsToEarn - status.approvalsInRow;
      supervised.push(`${category} (${remaining} more approval${remaining === 1 ? "" : "s"} in a row needed)`);
      supervisedFi.push(`${CATEGORY_FI[category]} (tarvitaan vielä ${remaining} peräkkäistä hyväksyntää)`);
    } else if (amount > status.capEurCents!) {
      overCap.push(`${formatEur(amount)} of ${category} is above the ${formatEur(status.capEurCents!)} the agent has earned`);
      overCapFi.push(`${CATEGORY_FI[category]} ${fiEur(amount)} ylittää agentin ansaitseman ${fiEur(status.capEurCents!)}`);
    } else {
      earned.push(`${category} up to ${formatEur(status.capEurCents!)}`);
      earnedFi.push(`${CATEGORY_FI[category]} enintään ${fiEur(status.capEurCents!)}`);
    }
  }
  const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
  if (supervised.length === 0 && overCap.length === 0) {
    return {
      rule: "earned_autonomy",
      outcome: "passed",
      detail: `the agent has earned autonomy in ${list(earned)}`,
      detailFi: `agentti on ansainnut itsenäisyyden: ${fiList(earnedFi)}`,
    };
  }
  const parts = [
    ...(supervised.length > 0 ? [`the agent has not yet earned autonomy in ${list(supervised)}`] : []),
    ...overCap,
  ];
  const partsFi = [...(supervisedFi.length > 0 ? [`agentti ei ole vielä ansainnut itsenäisyyttä: ${fiList(supervisedFi)}`] : []), ...overCapFi];
  return { rule: "earned_autonomy", outcome: "needs_approval", detail: list(parts), detailFi: fiList(partsFi) };
}

function auditChange(store: Store, actor: Principal, summary: string, fi: Finnish, reason?: string, quoteId?: string) {
  recordAudit(store, actor, { action: "autonomy.changed", summary, fi, ...(reason ? { reason } : {}), ...(quoteId ? { quoteId } : {}) });
}

/** The buyer approved an agent's quote: each category in it moves toward autonomy. */
export function recordApproval(store: Store, actor: Principal, policy: AgentPolicy, byCategory: Map<ProductCategory, number>, quoteId: string) {
  const at = new Date().toISOString();
  for (const [category, amount] of byCategory) {
    const record = recordFor(store.trackRecords, policy.agentId, category);
    const before = categoryAutonomy(policy, record).status;
    record.approvalsInRow++;
    record.totals.approvals++;
    record.largestApprovedEurCents = Math.max(record.largestApprovedEurCents, amount);
    remember(record, { at, event: "approved", quoteId, amountEurCents: amount, note: `Approved ${formatEur(amount)} of ${category}.` });
    const after = categoryAutonomy(policy, record);
    if (policy.autonomy.mode === "earned" && before === "supervised" && after.status === "earned") {
      auditChange(
        store,
        actor,
        `${policy.agentName} earned autonomy in ${category}: it may now order ${category} alone up to ${formatEur(after.capEurCents!)}.`,
        {
          summary: `${fiPerson(policy.agentName)} ansaitsi itsenäisyyden tuoteryhmässä ${CATEGORY_FI[category]}: se voi nyt tilata itse enintään ${fiEur(after.capEurCents!)}.`,
          reason: `${record.approvalsInRow} peräkkäistä hyväksyntää.`,
        },
        `${record.approvalsInRow} approvals in a row.`,
        quoteId,
      );
    }
  }
}

/** A rejection or a refused attempt: the run in each category starts again, and a buyer's grant is withdrawn. */
export function recordSetback(
  store: Store,
  actor: Principal,
  policy: AgentPolicy,
  categories: Iterable<ProductCategory>,
  kind: "rejected" | "refused",
  reason: string,
  quoteId?: string,
) {
  const at = new Date().toISOString();
  for (const category of new Set(categories)) {
    const record = recordFor(store.trackRecords, policy.agentId, category);
    const wasEarned = categoryAutonomy(policy, record).status === "earned";
    record.approvalsInRow = 0;
    record.largestApprovedEurCents = 0;
    delete record.grant;
    if (kind === "rejected") record.totals.rejections++;
    else record.totals.refusals++;
    record.lastReset = { at, reason };
    remember(record, { at, event: kind, ...(quoteId ? { quoteId } : {}), note: reason });
    if (policy.autonomy.mode === "earned" && wasEarned) {
      auditChange(
        store,
        actor,
        `${policy.agentName} lost its autonomy in ${category} and is supervised again.`,
        {
          summary: `${fiPerson(policy.agentName)} menetti itsenäisyytensä tuoteryhmässä ${CATEGORY_FI[category]} ja on taas valvottu.`,
          reason: kind === "rejected" ? "Ostaja hylkäsi tarjouksen." : "Säännöt estivät agentin yrityksen.",
        },
        reason,
        quoteId,
      );
    }
  }
}

/** The buyer grants a category directly, up to a limit no higher than the agent's policy limit. */
export function grantAutonomy(store: Store, actor: Principal, policy: AgentPolicy, category: ProductCategory, capEurCents: number) {
  const record = recordFor(store.trackRecords, policy.agentId, category);
  const at = new Date().toISOString();
  record.grant = { capEurCents, at, by: actor.name };
  remember(record, { at, event: "granted", amountEurCents: capEurCents, note: `${actor.name} granted autonomy up to ${formatEur(capEurCents)}.` });
  auditChange(store, actor, `Granted ${policy.agentName} autonomy in ${category} up to ${formatEur(capEurCents)}.`, {
    summary: `Agentille ${fiPerson(policy.agentName)} myönnettiin itsenäisyys tuoteryhmässä ${CATEGORY_FI[category]}, enintään ${fiEur(capEurCents)}.`,
  });
  return categoryAutonomy(policy, record);
}

/** The buyer takes a category back: the agent is supervised there until it earns it again. */
export function revokeAutonomy(store: Store, actor: Principal, policy: AgentPolicy, category: ProductCategory, reason: string) {
  const record = recordFor(store.trackRecords, policy.agentId, category);
  const at = new Date().toISOString();
  record.approvalsInRow = 0;
  record.largestApprovedEurCents = 0;
  delete record.grant;
  record.lastReset = { at, reason };
  remember(record, { at, event: "revoked", note: reason });
  auditChange(
    store,
    actor,
    `Revoked ${policy.agentName}'s autonomy in ${category}. It is supervised there again.`,
    { summary: `Agentin ${fiPerson(policy.agentName)} itsenäisyys tuoteryhmässä ${CATEGORY_FI[category]} peruttiin. Se on siellä taas valvottu.`, reason: "Ostaja perui itsenäisyyden." },
    reason,
  );
  return categoryAutonomy(policy, record);
}
