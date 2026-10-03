/**
 * Repository access layer.
 *
 * Two adapters behind one interface:
 *   - Neon Postgres  (production, requires DATABASE_URL)
 *   - PGlite         (zero-config local dev + tests, embedded WASM Postgres)
 *
 * Both speak the same SQL, so the schema, queries, indexes and constraints are
 * written once. PGlite is never selected in production: adapter selection below
 * throws if NODE_ENV === "production" without a real DATABASE_URL, because
 * silently using an embedded database in production would lose every saved plan
 * on the next cold start.
 */

import { randomUUID } from "node:crypto";
import { GENESIS_SEAL, sealEvent } from "./integrity";
import type {
  AuditEvent,
  CreateObservationInput,
  CreatePlanInput,
  Observation,
  ObservingPlan,
  PlannedTarget,
  UpdateObservationInput,
  UpdatePlanInput,
} from "./types";

export type SqlExecutor = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export function resolveDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || undefined;
}

/**
 * Postgres schema for nightglass tables.
 *
 * Defaults to `public`. Deployments sharing one Postgres instance with another
 * application can set `DATABASE_SCHEMA` to namespace instead of colliding. The
 * value is interpolated into DDL, so it is validated against a strict identifier
 * pattern before use.
 */
const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export function resolveSchema(): string {
  const raw = process.env.DATABASE_SCHEMA?.trim();
  if (!raw) return "public";
  if (!SCHEMA_PATTERN.test(raw)) {
    throw new Error(
      `DATABASE_SCHEMA must match ${SCHEMA_PATTERN} (lowercase letters, digits and underscores, not starting with a digit).`,
    );
  }
  return raw;
}

/**
 * Normalise a driver result into `{ rows }`.
 *
 * The two supported drivers disagree: `@neondatabase/serverless` returns a plain
 * array of row objects while the pg-compatible surface returns `{ rows }`.
 * Reading `.rows` off a bare array yields undefined, which turns every SELECT
 * into an empty result set — reads look like "no data" rather than like an
 * error, and that failure is silent.
 */
export function normalizeRows<T>(result: unknown): { rows: T[] } {
  if (Array.isArray(result)) return { rows: result as T[] };
  const rows = (result as { rows?: T[] } | null | undefined)?.rows;
  return { rows: Array.isArray(rows) ? rows : [] };
}

export interface Repository {
  readonly kind: "neon-postgres" | "pglite-embedded";
  init(): Promise<void>;
  createPlan(ownerId: string, input: CreatePlanInput): Promise<ObservingPlan>;
  listPlans(ownerId: string, limit: number, offset: number): Promise<{ items: ObservingPlan[]; total: number }>;
  getPlan(ownerId: string, id: string): Promise<ObservingPlan | null>;
  updatePlan(ownerId: string, id: string, input: UpdatePlanInput): Promise<ObservingPlan | null>;
  deletePlan(ownerId: string, id: string): Promise<ObservingPlan | null>;
  createObservation(ownerId: string, input: CreateObservationInput): Promise<Observation>;
  listObservations(ownerId: string, limit: number, offset: number): Promise<{ items: Observation[]; total: number }>;
  getObservation(ownerId: string, id: string): Promise<Observation | null>;
  updateObservation(ownerId: string, id: string, input: UpdateObservationInput): Promise<Observation | null>;
  deleteObservation(ownerId: string, id: string): Promise<Observation | null>;
  appendAudit(chainId: string, action: AuditEvent["action"], payload: unknown, ownerId: string): Promise<AuditEvent>;
  listAudit(chainId?: string): Promise<AuditEvent[]>;
  headSeal(chainId?: string): Promise<string>;
  findPlanByIdempotencyKey(ownerId: string, key: string): Promise<ObservingPlan | null>;
  health(): Promise<{ ok: boolean; detail: string }>;
  close(): Promise<void>;
}

/**
 * Schema DDL, one statement per entry.
 *
 * Issued individually rather than as a multi-statement script because both
 * drivers use the PostgreSQL extended query protocol for `query()`, which
 * rejects more than one statement per call.
 */
function schemaStatements(schema: string): string[] {
  return [
    `CREATE SCHEMA IF NOT EXISTS ${schema}`,
    `CREATE TABLE IF NOT EXISTS ${schema}.plans (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      site            JSONB NOT NULL,
      instrument      JSONB NOT NULL,
      night_of        TEXT NOT NULL,
      targets         JSONB NOT NULL DEFAULT '[]'::jsonb,
      owner_id        TEXT NOT NULL,
      idempotency_key TEXT,
      deleted         BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    )`,
    // NOTE: Postgres does not allow a schema-qualified *index name*. Only the
    // target table may be qualified; an index lives in its table's schema.
    `CREATE INDEX IF NOT EXISTS idx_plans_owner
       ON ${schema}.plans (owner_id, created_at DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_idem
       ON ${schema}.plans (owner_id, idempotency_key)
       WHERE idempotency_key IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS ${schema}.observations (
      id          TEXT PRIMARY KEY,
      plan_id     TEXT,
      object_id   TEXT NOT NULL,
      object_name TEXT NOT NULL,
      seen_on     TEXT NOT NULL,
      confidence  INTEGER NOT NULL,
      notes       TEXT NOT NULL DEFAULT '',
      observed_at TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      deleted     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      CONSTRAINT observations_confidence_range CHECK (confidence BETWEEN 1 AND 5)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_observations_owner
       ON ${schema}.observations (owner_id, observed_at DESC)`,
    `CREATE TABLE IF NOT EXISTS ${schema}.audit_events (
      seq         BIGSERIAL PRIMARY KEY,
      id          TEXT NOT NULL UNIQUE,
      chain_id    TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      action      TEXT NOT NULL,
      payload     TEXT NOT NULL,
      prev_seal   TEXT NOT NULL,
      seal        TEXT NOT NULL,
      created_at  TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_chain
       ON ${schema}.audit_events (chain_id, seq ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_seq
       ON ${schema}.audit_events (seq ASC)`,
  ];
}

function rowToPlan(row: Record<string, unknown>): ObservingPlan {
  return {
    id: String(row.id),
    name: String(row.name),
    site: row.site as ObservingPlan["site"],
    instrument: row.instrument as ObservingPlan["instrument"],
    nightOf: String(row.night_of),
    targets: (row.targets ?? []) as PlannedTarget[],
    ownerId: String(row.owner_id),
    idempotencyKey: row.idempotency_key === null || row.idempotency_key === undefined ? null : String(row.idempotency_key),
    deleted: Boolean(row.deleted),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToObservation(row: Record<string, unknown>): Observation {
  return {
    id: String(row.id),
    planId: row.plan_id === null || row.plan_id === undefined ? null : String(row.plan_id),
    objectId: String(row.object_id),
    objectName: String(row.object_name),
    seenOn: String(row.seen_on),
    confidence: Number(row.confidence),
    notes: String(row.notes ?? ""),
    observedAt: String(row.observed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ownerId: String(row.owner_id),
    deleted: Boolean(row.deleted),
  };
}

function makeRepository(kind: Repository["kind"], db: SqlExecutor): Repository {
  const exec = (sql: string, params?: unknown[]) => db.query(sql, params);
  const schema = resolveSchema();

  const repo: Repository = {
    kind,

    async init() {
      for (const statement of schemaStatements(schema)) {
        await exec(statement);
      }
    },

    async createPlan(ownerId, input) {
      if (input.idempotencyKey) {
        const existing = await repo.findPlanByIdempotencyKey(ownerId, input.idempotencyKey);
        if (existing) return existing;
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      await exec(
        `INSERT INTO ${schema}.plans (id, name, site, instrument, night_of, targets, owner_id, idempotency_key, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7, $8, $9, $9)`,
        [
          id,
          input.name,
          JSON.stringify(input.site),
          JSON.stringify(input.instrument),
          input.nightOf,
          JSON.stringify(input.targets),
          ownerId,
          input.idempotencyKey ?? null,
          now,
        ],
      );
      return {
        id,
        name: input.name,
        site: input.site,
        instrument: input.instrument,
        nightOf: input.nightOf,
        targets: input.targets,
        ownerId,
        idempotencyKey: input.idempotencyKey ?? null,
        deleted: false,
        createdAt: now,
        updatedAt: now,
      };
    },

    async listPlans(ownerId, limit, offset) {
      const rows = await exec(
        `SELECT * FROM ${schema}.plans WHERE owner_id = $1 AND deleted = FALSE
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [ownerId, limit, offset],
      );
      const count = await exec(
        `SELECT COUNT(*)::int AS total FROM ${schema}.plans WHERE owner_id = $1 AND deleted = FALSE`,
        [ownerId],
      );
      const totalRow = count.rows[0] as { total?: number } | undefined;
      return { items: rows.rows.map(rowToPlan), total: totalRow?.total ?? 0 };
    },

    async getPlan(ownerId, id) {
      // Soft-deleted plans are invisible to normal reads; the tombstone row
      // stays so the audit chain remains replayable.
      const res = await exec(
        `SELECT * FROM ${schema}.plans WHERE id = $1 AND owner_id = $2 AND deleted = FALSE`,
        [id, ownerId],
      );
      const row = res.rows[0];
      return row ? rowToPlan(row) : null;
    },

    async updatePlan(ownerId, id, input) {
      const current = await repo.getPlan(ownerId, id);
      if (!current || current.deleted) return null;
      const now = new Date().toISOString();
      await exec(
        `UPDATE ${schema}.plans
            SET name = $1, site = $2::jsonb, instrument = $3::jsonb, night_of = $4, targets = $5::jsonb, updated_at = $6
          WHERE id = $7 AND owner_id = $8`,
        [
          input.name ?? current.name,
          JSON.stringify(input.site ?? current.site),
          JSON.stringify(input.instrument ?? current.instrument),
          input.nightOf ?? current.nightOf,
          JSON.stringify(input.targets ?? current.targets),
          now,
          id,
          ownerId,
        ],
      );
      return {
        ...current,
        name: input.name ?? current.name,
        site: input.site ?? current.site,
        instrument: input.instrument ?? current.instrument,
        nightOf: input.nightOf ?? current.nightOf,
        targets: input.targets ?? current.targets,
        updatedAt: now,
      };
    },

    async deletePlan(ownerId, id) {
      const current = await repo.getPlan(ownerId, id);
      if (!current || current.deleted) return null;
      const now = new Date().toISOString();
      await exec(`UPDATE ${schema}.plans SET deleted = TRUE, updated_at = $1 WHERE id = $2 AND owner_id = $3`, [
        now,
        id,
        ownerId,
      ]);
      return { ...current, deleted: true, updatedAt: now };
    },

    async createObservation(ownerId, input) {
      const id = randomUUID();
      const now = new Date().toISOString();
      await exec(
        `INSERT INTO ${schema}.observations (id, plan_id, object_id, object_name, seen_on, confidence, notes, observed_at, owner_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [
          id,
          input.planId ?? null,
          input.objectId,
          input.objectName,
          input.seenOn,
          input.confidence,
          input.notes ?? "",
          input.observedAt,
          ownerId,
          now,
        ],
      );
      return {
        id,
        planId: input.planId ?? null,
        objectId: input.objectId,
        objectName: input.objectName,
        seenOn: input.seenOn,
        confidence: input.confidence,
        notes: input.notes ?? "",
        observedAt: input.observedAt,
        createdAt: now,
        updatedAt: now,
        ownerId,
        deleted: false,
      };
    },

    async listObservations(ownerId, limit, offset) {
      const rows = await exec(
        `SELECT * FROM ${schema}.observations WHERE owner_id = $1 AND deleted = FALSE
         ORDER BY observed_at DESC LIMIT $2 OFFSET $3`,
        [ownerId, limit, offset],
      );
      const count = await exec(
        `SELECT COUNT(*)::int AS total FROM ${schema}.observations WHERE owner_id = $1 AND deleted = FALSE`,
        [ownerId],
      );
      const totalRow = count.rows[0] as { total?: number } | undefined;
      return { items: rows.rows.map(rowToObservation), total: totalRow?.total ?? 0 };
    },

    async getObservation(ownerId, id) {
      const res = await exec(
        `SELECT * FROM ${schema}.observations WHERE id = $1 AND owner_id = $2 AND deleted = FALSE`,
        [id, ownerId],
      );
      const row = res.rows[0];
      return row ? rowToObservation(row) : null;
    },

    async updateObservation(ownerId, id, input) {
      const current = await repo.getObservation(ownerId, id);
      if (!current || current.deleted) return null;
      const now = new Date().toISOString();
      await exec(
        `UPDATE ${schema}.observations
            SET object_name = $1, seen_on = $2, confidence = $3, notes = $4, observed_at = $5, updated_at = $6
          WHERE id = $7 AND owner_id = $8`,
        [
          input.objectName ?? current.objectName,
          input.seenOn ?? current.seenOn,
          input.confidence ?? current.confidence,
          input.notes ?? current.notes,
          input.observedAt ?? current.observedAt,
          now,
          id,
          ownerId,
        ],
      );
      return {
        ...current,
        objectName: input.objectName ?? current.objectName,
        seenOn: input.seenOn ?? current.seenOn,
        confidence: input.confidence ?? current.confidence,
        notes: input.notes ?? current.notes,
        observedAt: input.observedAt ?? current.observedAt,
        updatedAt: now,
      };
    },

    async deleteObservation(ownerId, id) {
      const current = await repo.getObservation(ownerId, id);
      if (!current || current.deleted) return null;
      const now = new Date().toISOString();
      await exec(
        `UPDATE ${schema}.observations SET deleted = TRUE, updated_at = $1 WHERE id = $2 AND owner_id = $3`,
        [now, id, ownerId],
      );
      return { ...current, deleted: true, updatedAt: now };
    },

    async appendAudit(chainId, action, payload, ownerId) {
      // Per-entity chain: each plan's history starts from genesis and is
      // independent of every other plan's.
      const prevSeal = await repo.headSeal(chainId);
      const event = sealEvent(prevSeal, {
        id: randomUUID(),
        planId: chainId,
        action,
        payload: JSON.stringify(payload ?? null),
        prevSeal,
        createdAt: new Date().toISOString(),
      });
      await exec(
        `INSERT INTO ${schema}.audit_events (id, chain_id, owner_id, action, payload, prev_seal, seal, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [event.id, chainId, ownerId, event.action, event.payload, event.prevSeal, event.seal, event.createdAt],
      );
      return event;
    },

    async listAudit(chainId) {
      const res = chainId
        ? await exec(`SELECT * FROM ${schema}.audit_events WHERE chain_id = $1 ORDER BY seq ASC`, [chainId])
        : await exec(`SELECT * FROM ${schema}.audit_events ORDER BY seq ASC`);
      return res.rows.map(
        (r): AuditEvent => ({
          id: String(r.id),
          planId: String(r.chain_id),
          action: r.action as AuditEvent["action"],
          payload: String(r.payload),
          seal: String(r.seal),
          prevSeal: String(r.prev_seal),
          createdAt: String(r.created_at),
        }),
      );
    },

    async headSeal(chainId) {
      const res = chainId
        ? await exec(`SELECT seal FROM ${schema}.audit_events WHERE chain_id = $1 ORDER BY seq DESC LIMIT 1`, [chainId])
        : await exec(`SELECT seal FROM ${schema}.audit_events ORDER BY seq DESC LIMIT 1`);
      const row = res.rows[0] as { seal?: string } | undefined;
      return row?.seal ?? GENESIS_SEAL;
    },

    async findPlanByIdempotencyKey(ownerId, key) {
      const res = await exec(
        `SELECT * FROM ${schema}.plans WHERE owner_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [ownerId, key],
      );
      const row = res.rows[0];
      return row ? rowToPlan(row) : null;
    },

    async health() {
      try {
        const res = await exec(`SELECT 1 AS ok`);
        const row = res.rows[0] as { ok?: number } | undefined;
        if (row?.ok === 1) return { ok: true, detail: "SELECT 1 succeeded" };
        return { ok: false, detail: "health query returned no rows" };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : "unknown database error" };
      }
    },

    async close() {
      /* PGlite is a singleton in this process; nothing to close for Neon. */
    },
  };

  return repo;
}

/* -------------------------------------------------------------------------- */
/* Neon adapter (production)                                                  */
/* -------------------------------------------------------------------------- */

let neonRepo: Repository | null = null;

async function getNeonRepository(): Promise<Repository> {
  if (neonRepo) return neonRepo;
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error(
      "No production database configured. Set DATABASE_URL (or POSTGRES_URL, which the Vercel/Neon integrations provide) to a hosted Postgres connection string; nightglass will not fall back to an embedded database in production.",
    );
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  const executor: SqlExecutor = {
    async query<T>(statement: string, params: unknown[] = []) {
      const result = (await sql.query(statement, params as never[])) as unknown;
      return normalizeRows<T>(result);
    },
  };
  neonRepo = makeRepository("neon-postgres", executor);
  return neonRepo;
}

/* -------------------------------------------------------------------------- */
/* PGlite adapter (zero-config local + tests)                                  */
/* -------------------------------------------------------------------------- */

let pgliteRepo: Repository | null = null;
let pgliteInit: Promise<Repository> | null = null;

async function getPgliteRepository(): Promise<Repository> {
  if (pgliteRepo) return pgliteRepo;
  if (pgliteInit) return pgliteInit;

  pgliteInit = (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const client = await PGlite.create();
    const executor: SqlExecutor = {
      async query<T>(statement: string, params: unknown[] = []) {
        const result = await client.query<T>(statement, params as never[]);
        return { rows: result.rows };
      },
    };
    pgliteRepo = makeRepository("pglite-embedded", executor);
    return pgliteRepo;
  })();

  return pgliteInit;
}

export async function getRepository(): Promise<Repository> {
  const isProduction = process.env.NODE_ENV === "production";
  const hasDatabaseUrl = Boolean(resolveDatabaseUrl());

  if (isProduction) {
    if (!hasDatabaseUrl) {
      throw new Error(
        "Refusing to start in production without a database connection string. Set DATABASE_URL " +
          "(or POSTGRES_URL). nightglass will not fall back to an embedded database in production, " +
          "because that would silently lose every saved plan on the next cold start.",
      );
    }
    return getNeonRepository();
  }

  if (hasDatabaseUrl) return getNeonRepository();
  return getPgliteRepository();
}

export { makeRepository };