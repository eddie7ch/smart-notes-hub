import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  list(userId: string): Promise<Item[]>;
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

  async list(userId: string): Promise<Item[]> {
    return this.db
      .prepare(
        "SELECT id, user_id, type, title, content, status, created_at, updated_at FROM items WHERE user_id = ? ORDER BY updated_at DESC"
      )
      .all(userId) as unknown as Item[];
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

    this.ready = this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS items (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('note', 'task')),
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          embedding TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );`
      )
      .then(() => undefined);
  }

  async list(userId: string): Promise<Item[]> {
    await this.ready;
    const { rows } = await this.pool.query(
      "SELECT id, user_id, type, title, content, status, created_at, updated_at FROM items WHERE user_id = $1 ORDER BY updated_at DESC",
      [userId]
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
      "INSERT INTO items (user_id, type, title, content, status, embedding) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
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
      "UPDATE items SET title = $1, content = $2, status = $3, embedding = $4, updated_at = now() WHERE id = $5 AND user_id = $6 RETURNING *",
      [title, content, status, embedding, id, userId]
    );
    return rows[0];
  }

  async remove(id: number, userId: string): Promise<void> {
    await this.ready;
    await this.pool.query("DELETE FROM items WHERE id = $1 AND user_id = $2", [id, userId]);
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
