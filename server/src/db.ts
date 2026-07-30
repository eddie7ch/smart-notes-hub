import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { cosineSimilarity } from "./services/embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ScoredItem {
  id: number;
  type: string;
  title: string;
  content: string;
  score: number;
}

export interface Item {
  id: number;
  user_id: string;
  type: "note" | "task";
  title: string;
  content: string;
  status: string;
  embedding: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateFields {
  title?: string;
  content?: string;
  status?: string;
  embedding?: string | null;
}

export interface ItemRepository {
  list(userId: string, limit: number, offset: number): Promise<Item[]>;
  listWithEmbeddings(userId: string): Promise<Item[]>;
  get(id: number, userId: string): Promise<Item | undefined>;
  create(
    userId: string,
    type: string,
    title: string,
    content: string,
    status: string,
    embedding: string | null
  ): Promise<Item>;
  update(id: number, userId: string, fields: UpdateFields): Promise<Item | undefined>;
  remove(id: number, userId: string): Promise<void>;
  semanticSearch(userId: string, queryEmbedding: number[], k: number): Promise<ScoredItem[]>;
}

// Local-dev default: zero setup, no cost, no external DB required.
class SqliteItemRepository implements ItemRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('note', 'task')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        embedding TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  async list(userId: string, limit: number, offset: number): Promise<Item[]> {
    return this.db
      .prepare(
        "SELECT id, user_id, type, title, content, status, created_at, updated_at FROM items WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?"
      )
      .all(userId, limit, offset) as unknown as Item[];
  }

  async listWithEmbeddings(userId: string): Promise<Item[]> {
    return this.db
      .prepare("SELECT * FROM items WHERE user_id = ? AND embedding IS NOT NULL")
      .all(userId) as unknown as Item[];
  }

  async get(id: number, userId: string): Promise<Item | undefined> {
    return this.db.prepare("SELECT * FROM items WHERE id = ? AND user_id = ?").get(id, userId) as unknown as
      | Item
      | undefined;
  }

  async create(
    userId: string,
    type: string,
    title: string,
    content: string,
    status: string,
    embedding: string | null
  ): Promise<Item> {
    const result = this.db
      .prepare("INSERT INTO items (user_id, type, title, content, status, embedding) VALUES (?, ?, ?, ?, ?, ?)")
      .run(userId, type, title, content, status, embedding);
    return (await this.get(Number(result.lastInsertRowid), userId))!;
  }

  async update(id: number, userId: string, fields: UpdateFields): Promise<Item | undefined> {
    const existing = await this.get(id, userId);
    if (!existing) return undefined;
    const title = fields.title ?? existing.title;
    const content = fields.content ?? existing.content;
    const status = fields.status ?? existing.status;
    const embedding = fields.embedding !== undefined ? fields.embedding : existing.embedding;
    this.db
      .prepare(
        "UPDATE items SET title = ?, content = ?, status = ?, embedding = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
      )
      .run(title, content, status, embedding, id, userId);
    return this.get(id, userId);
  }

  async remove(id: number, userId: string): Promise<void> {
    this.db.prepare("DELETE FROM items WHERE id = ? AND user_id = ?").run(id, userId);
  }

  // No vector index locally - fine at dev scale, computed in JS instead.
  async semanticSearch(userId: string, queryEmbedding: number[], k: number): Promise<ScoredItem[]> {
    const rows = await this.listWithEmbeddings(userId);
    return rows
      .map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        content: row.content,
        score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding as string)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

// Production: Cloud SQL for PostgreSQL, reached either over Cloud Run's native
// Cloud SQL Unix-socket integration (no VPC connector needed/billed) or a plain
// DATABASE_URL for any other hosted Postgres.
class PostgresItemRepository implements ItemRepository {
  private pool: pg.Pool;
  private ready: Promise<void>;

  constructor() {
    const socketPath = process.env.INSTANCE_UNIX_SOCKET;
    this.pool = socketPath
      ? new pg.Pool({
          host: socketPath,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
        })
      : new pg.Pool({ connectionString: process.env.DATABASE_URL });

    // pgvector gives real nearest-neighbor search in Postgres itself instead of
    // pulling every row into Node and comparing vectors in a JS loop.
    this.ready = this.pool
      .query(`CREATE EXTENSION IF NOT EXISTS vector;`)
      .then(() =>
        this.pool.query(
          `CREATE TABLE IF NOT EXISTS items (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('note', 'task')),
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            embedding vector(1536),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );`
        )
      )
      .then(() =>
        // One-time migration for instances created before pgvector was added,
        // where embedding was a plain TEXT column of JSON-encoded floats.
        this.pool.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = 'items' AND column_name = 'embedding' AND data_type = 'text'
            ) THEN
              ALTER TABLE items DROP COLUMN embedding;
              ALTER TABLE items ADD COLUMN embedding vector(1536);
            END IF;
          END $$;
        `)
      )
      .then(() => undefined);

    // This chain runs at startup, independent of any request. If nobody has
    // awaited `this.ready` yet by the time it rejects (e.g. Cloud SQL is
    // stopped), Node treats it as an unhandled rejection and kills the
    // process - taking down unrelated routes like /health too. Attaching a
    // no-op catch here just marks it handled; callers awaiting `this.ready`
    // still see the rejection and can respond with an error per-request.
    this.ready.catch(() => {});
  }

  async list(userId: string, limit: number, offset: number): Promise<Item[]> {
    await this.ready;
    const { rows } = await this.pool.query(
      "SELECT id, user_id, type, title, content, status, created_at, updated_at FROM items WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3",
      [userId, limit, offset]
    );
    return rows;
  }

  async listWithEmbeddings(userId: string): Promise<Item[]> {
    await this.ready;
    const { rows } = await this.pool.query(
      "SELECT * FROM items WHERE user_id = $1 AND embedding IS NOT NULL",
      [userId]
    );
    return rows;
  }

  async get(id: number, userId: string): Promise<Item | undefined> {
    await this.ready;
    const { rows } = await this.pool.query("SELECT * FROM items WHERE id = $1 AND user_id = $2", [id, userId]);
    return rows[0];
  }

  async create(
    userId: string,
    type: string,
    title: string,
    content: string,
    status: string,
    embedding: string | null
  ): Promise<Item> {
    await this.ready;
    const { rows } = await this.pool.query(
      "INSERT INTO items (user_id, type, title, content, status, embedding) VALUES ($1, $2, $3, $4, $5, $6::vector) RETURNING *",
      [userId, type, title, content, status, embedding]
    );
    return rows[0];
  }

  async update(id: number, userId: string, fields: UpdateFields): Promise<Item | undefined> {
    await this.ready;
    const existing = await this.get(id, userId);
    if (!existing) return undefined;
    const title = fields.title ?? existing.title;
    const content = fields.content ?? existing.content;
    const status = fields.status ?? existing.status;
    const embedding = fields.embedding !== undefined ? fields.embedding : existing.embedding;
    const { rows } = await this.pool.query(
      "UPDATE items SET title = $1, content = $2, status = $3, embedding = $4::vector, updated_at = now() WHERE id = $5 AND user_id = $6 RETURNING *",
      [title, content, status, embedding, id, userId]
    );
    return rows[0];
  }

  async remove(id: number, userId: string): Promise<void> {
    await this.ready;
    await this.pool.query("DELETE FROM items WHERE id = $1 AND user_id = $2", [id, userId]);
  }

  // Cosine distance computed by Postgres/pgvector itself (the `<=>` operator),
  // not fetched into Node and compared in a JS loop - this is real vector-DB search.
  async semanticSearch(userId: string, queryEmbedding: number[], k: number): Promise<ScoredItem[]> {
    await this.ready;
    const vectorLiteral = `[${queryEmbedding.join(",")}]`;
    const { rows } = await this.pool.query(
      `SELECT id, type, title, content, 1 - (embedding <=> $2::vector) AS score
       FROM items
       WHERE user_id = $1 AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [userId, vectorLiteral, k]
    );
    return rows;
  }
}

function createItemRepository(): ItemRepository {
  if (process.env.INSTANCE_UNIX_SOCKET || process.env.DATABASE_URL) {
    return new PostgresItemRepository();
  }
  const dbPath = process.env.DB_PATH ?? path.join(__dirname, "..", "data.db");
  return new SqliteItemRepository(dbPath);
}

export const itemRepository = createItemRepository();
