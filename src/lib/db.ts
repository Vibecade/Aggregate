import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import type { StoryInput, StoryListOptions, StoryRecord, StoryStats, StoryType } from "@/lib/types";

const DATA_DIRECTORY = path.join(process.cwd(), "data");
const DATABASE_PATH = path.join(DATA_DIRECTORY, "aggregate.sqlite");

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS stories (
    uid TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    source TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('news', 'twitter', 'farcaster')),
    published_at TEXT NOT NULL,
    summary TEXT,
    author TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_stories_published_at ON stories(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_stories_source_type ON stories(source_type);

  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`;

fs.mkdirSync(DATA_DIRECTORY, { recursive: true });

let database: Database.Database | null = null;
let schemaInitialized = false;

function sleep(milliseconds: number): void {
  const array = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(array, 0, 0, milliseconds);
}

function initializeSchema(db: Database.Database): void {
  if (schemaInitialized) {
    return;
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      db.exec(SCHEMA_SQL);
      try {
        db.pragma("journal_mode = WAL");
      } catch {
        // Fallback to default mode if WAL switch is currently locked.
      }
      db.pragma("synchronous = NORMAL");
      schemaInitialized = true;
      return;
    } catch (error) {
      lastError = error;

      if (error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message)) {
        sleep(80 + attempt * 40);
        continue;
      }

      throw error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Failed to initialize SQLite schema");
}

function getDb(): Database.Database {
  if (!database) {
    database = new Database(DATABASE_PATH);
    database.pragma("busy_timeout = 10000");
  }

  initializeSchema(database);
  return database;
}

type StoryRow = {
  uid: string;
  title: string;
  url: string;
  source: string;
  source_type: StoryType;
  published_at: string;
  summary: string | null;
  author: string | null;
  created_at: string;
  updated_at: string;
};

function toStoryRecord(row: StoryRow): StoryRecord {
  return {
    uid: row.uid,
    title: row.title,
    url: row.url,
    source: row.source,
    sourceType: row.source_type,
    publishedAt: row.published_at,
    summary: row.summary ?? undefined,
    author: row.author ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) {
    return 200;
  }

  return Math.min(Math.max(Math.floor(limit), 1), 500);
}

export function upsertStories(stories: StoryInput[]): number {
  if (stories.length === 0) {
    return 0;
  }

  const db = getDb();
  const beforeCount = getStoryCount();
  const now = new Date().toISOString();

  const upsertStoryStatement = db.prepare(`
    INSERT INTO stories (
      uid,
      title,
      url,
      source,
      source_type,
      published_at,
      summary,
      author,
      created_at,
      updated_at
    ) VALUES (
      @uid,
      @title,
      @url,
      @source,
      @sourceType,
      @publishedAt,
      @summary,
      @author,
      @now,
      @now
    )
    ON CONFLICT(uid) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      source = excluded.source,
      source_type = excluded.source_type,
      published_at = excluded.published_at,
      summary = excluded.summary,
      author = excluded.author,
      updated_at = excluded.updated_at
  `);

  const transaction = db.transaction((batch: StoryInput[]) => {
    for (const story of batch) {
      upsertStoryStatement.run({
        ...story,
        summary: story.summary ?? null,
        author: story.author ?? null,
        now,
      });
    }
  });

  transaction(stories);

  const afterCount = getStoryCount();
  return Math.max(0, afterCount - beforeCount);
}

export function listStories(options: StoryListOptions = {}): StoryRecord[] {
  const db = getDb();
  const limit = normalizeLimit(options.limit);

  const rows = options.type
    ? (db
        .prepare(
          `
            SELECT
              uid,
              title,
              url,
              source,
              source_type,
              published_at,
              summary,
              author,
              created_at,
              updated_at
            FROM stories
            WHERE source_type = ?
            ORDER BY datetime(published_at) DESC, datetime(updated_at) DESC
            LIMIT ?
          `,
        )
        .all(options.type, limit) as StoryRow[])
    : (db
        .prepare(
          `
            SELECT
              uid,
              title,
              url,
              source,
              source_type,
              published_at,
              summary,
              author,
              created_at,
              updated_at
            FROM stories
            ORDER BY datetime(published_at) DESC, datetime(updated_at) DESC
            LIMIT ?
          `,
        )
        .all(limit) as StoryRow[]);

  return rows.map(toStoryRecord);
}

export function getStoryCount(type?: StoryType): number {
  const db = getDb();

  if (type) {
    const result = db
      .prepare(`SELECT COUNT(*) AS count FROM stories WHERE source_type = ?`)
      .get(type) as
      | {
          count: number;
        }
      | undefined;

    return result?.count ?? 0;
  }

  const result = db.prepare(`SELECT COUNT(*) AS count FROM stories`).get() as
    | {
        count: number;
      }
    | undefined;

  return result?.count ?? 0;
}

export function getStoryStats(): StoryStats {
  const db = getDb();
  const byType: Record<StoryType, number> = {
    news: 0,
    twitter: 0,
    farcaster: 0,
  };

  const rows = db
    .prepare(
      `
        SELECT source_type AS sourceType, COUNT(*) AS count
        FROM stories
        GROUP BY source_type
      `,
    )
    .all() as Array<{ sourceType: StoryType; count: number }>;

  for (const row of rows) {
    if (row.sourceType in byType) {
      byType[row.sourceType] = row.count;
    }
  }

  return {
    total: byType.news + byType.twitter + byType.farcaster,
    byType,
  };
}

export function setSyncValue(key: string, value: string): void {
  const db = getDb();

  db.prepare(
    `
      INSERT INTO sync_state (key, value, updated_at)
      VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
  ).run(key, value);
}

export function getSyncValue(key: string): string | null {
  const db = getDb();

  const row = db.prepare(`SELECT value FROM sync_state WHERE key = ?`).get(key) as
    | {
        value: string;
      }
    | undefined;

  return row?.value ?? null;
}

export function pruneStories(maxRows: number): void {
  const db = getDb();
  const sanitizedMaxRows = Math.max(1, Math.floor(maxRows));

  db.prepare(
    `
      DELETE FROM stories
      WHERE uid IN (
        SELECT uid
        FROM stories
        ORDER BY datetime(published_at) DESC, datetime(updated_at) DESC
        LIMIT -1 OFFSET ?
      )
    `,
  ).run(sanitizedMaxRows);
}

export function getDatabasePath(): string {
  return DATABASE_PATH;
}
