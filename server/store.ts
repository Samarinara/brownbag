import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Fuse from 'fuse.js';
import {
  changeSchema,
  recipeSchema,
  type Change,
  type ChangeInput,
  type Recipe,
  type RecipeInput,
  type Revision,
  type User,
} from '../shared/schema.js';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const now = () => new Date().toISOString();

export class Store {
  db: Database.Database;
  private indexes = new Map<
    string,
    { recipes: Recipe[]; title: Fuse<Recipe>; full: Fuse<Recipe> }
  >();
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, yolo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_codes (email TEXT PRIMARY KEY, hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS password_credentials (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT);
      CREATE TABLE IF NOT EXISTS recipes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
      CREATE INDEX IF NOT EXISTS recipes_owner ON recipes(user_id, deleted_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS recipe_fts USING fts5(id UNINDEXED, user_id UNINDEXED, title, ingredients, tokenize='unicode61 remove_diacritics 2');
      CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), recipe_id TEXT NOT NULL REFERENCES recipes(id), version INTEGER NOT NULL, snapshot TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(recipe_id,version));
      CREATE INDEX IF NOT EXISTS revisions_owner ON revisions(user_id, recipe_id);
      CREATE TABLE IF NOT EXISTS changes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), payload TEXT NOT NULL, key_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS changes_owner ON changes(user_id,status);
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), event TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS audit_owner ON audit(user_id,created_at);
      INSERT OR IGNORE INTO migrations VALUES (1, datetime('now'));
    `);
  }
  user(id: string): User {
    const row = this.db.prepare('SELECT id,email,yolo FROM users WHERE id=?').get(id) as
      { id: string; email: string; yolo: number } | undefined;
    if (!row) throw new AppError(401, 'Sign in to continue.');
    return { ...row, yolo: !!row.yolo };
  }
  ensureUser(email: string): User {
    this.db
      .prepare('INSERT OR IGNORE INTO users(id,email,created_at) VALUES (?,?,?)')
      .run(randomUUID(), email, now());
    return this.user(
      (this.db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string }).id,
    );
  }
  audit(userId: string, event: string, detail: unknown) {
    this.db
      .prepare('INSERT INTO audit VALUES (?,?,?,?,?)')
      .run(randomUUID(), userId, event, JSON.stringify(detail), now());
  }
  private deserialize(row: any): Recipe {
    return {
      ...JSON.parse(row.data),
      id: row.id,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }
  get(userId: string, id: string, includeDeleted = false): Recipe {
    const row = this.db
      .prepare(
        `SELECT * FROM recipes WHERE user_id=? AND id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
      )
      .get(userId, id);
    if (!row) throw new AppError(404, 'Recipe not found.');
    return this.deserialize(row);
  }
  private index(userId: string) {
    let index = this.indexes.get(userId);
    if (!index) {
      const recipes = this.db
        .prepare(
          'SELECT * FROM recipes WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC, id',
        )
        .all(userId)
        .map((r) => this.deserialize(r));
      const options = {
        threshold: 0.42,
        ignoreLocation: true,
        includeScore: true,
        minMatchCharLength: 1,
      };
      index = {
        recipes,
        title: new Fuse(recipes, { ...options, keys: ['title'] }),
        full: new Fuse(recipes, { ...options, keys: ['ingredients.ingredient'] }),
      };
      if (this.indexes.size >= 100) this.indexes.delete(this.indexes.keys().next().value!);
      this.indexes.set(userId, index);
    }
    return index;
  }
  search(userId: string, query = '', titleOnly = false, tag = ''): Recipe[] {
    const index = this.index(userId);
    const q = query.trim().slice(0, 200);
    let recipes = index.recipes;
    if (q) {
      const title = index.title.search(q).map((r) => r.item);
      if (titleOnly) recipes = title;
      else {
        const words = q.match(/[\p{L}\p{N}]+/gu) || [];
        const fts = words.length
          ? (this.db
              .prepare(
                'SELECT id FROM recipe_fts WHERE recipe_fts MATCH ? AND user_id=? ORDER BY bm25(recipe_fts,0,0,5,1)',
              )
              .all(words.map((w) => `"${w}"*`).join(' AND '), userId) as { id: string }[])
          : [];
        const byId = new Map(index.recipes.map((r) => [r.id, r]));
        const seen = new Set<string>();
        // Match each ingredient term separately so typos still work across
        // different ingredient rows (for example "spagheti lemmon").
        const ingredientMatches = words.map((word) => index.full.search(word));
        const ingredientScores = ingredientMatches.map(
          (matches) => new Map(matches.map((match) => [match.item.id, match.score ?? 1])),
        );
        const fuzzyIngredients = (ingredientMatches[0] || [])
          .filter((match) => ingredientScores.every((scores) => scores.has(match.item.id)))
          .map((match) => ({
            recipe: match.item,
            score: ingredientScores.reduce((sum, scores) => sum + scores.get(match.item.id)!, 0),
          }))
          .sort((a, b) => a.score - b.score)
          .map((match) => match.recipe);
        recipes = [
          ...title,
          ...fts.map((r) => byId.get(r.id)).filter((r): r is Recipe => !!r),
          ...fuzzyIngredients,
        ].filter((r) => !seen.has(r.id) && !!seen.add(r.id));
      }
    }
    return tag ? recipes.filter((r) => r.tags.includes(tag)) : recipes;
  }
  private check(userId: string, id: string, version: number) {
    const recipe = this.get(userId, id);
    if (recipe.version !== version)
      throw new AppError(409, 'This recipe changed. Reload it and submit a new change.');
    return recipe;
  }
  private validateChange(userId: string, input: ChangeInput) {
    if (input.action !== 'create') this.check(userId, input.recipeId, input.baseVersion);
    if (input.action === 'merge') {
      if (input.recipeId === input.sourceId)
        throw new AppError(400, 'Choose two different recipes to merge.');
      this.check(userId, input.sourceId, input.sourceVersion);
    }
  }
  private write(
    userId: string,
    data: RecipeInput,
    actor: string,
    action: string,
    existing?: Recipe,
    deleted = false,
  ): Recipe {
    const id = existing?.id || randomUUID();
    const stamp = now();
    const recipe: Recipe = {
      ...recipeSchema.parse(data),
      id,
      version: (existing?.version || 0) + 1,
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp,
      deletedAt: deleted ? stamp : null,
    };
    this.db
      .prepare(
        `INSERT INTO recipes VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,data=excluded.data,version=excluded.version,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at`,
      )
      .run(
        id,
        userId,
        recipe.title,
        JSON.stringify(data),
        recipe.version,
        recipe.createdAt,
        stamp,
        recipe.deletedAt,
      );
    this.db.prepare('DELETE FROM recipe_fts WHERE id=?').run(id);
    if (!deleted)
      this.db
        .prepare('INSERT INTO recipe_fts(id,user_id,title,ingredients) VALUES (?,?,?,?)')
        .run(id, userId, recipe.title, recipe.ingredients.map((i) => i.ingredient).join(' '));
    this.db
      .prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), userId, id, recipe.version, JSON.stringify(recipe), action, actor, stamp);
    this.audit(userId, `recipe.${action}`, { recipeId: id, version: recipe.version, actor });
    this.indexes.delete(userId);
    return recipe;
  }
  private apply(userId: string, input: ChangeInput, actor: string) {
    this.validateChange(userId, input);
    if (input.action === 'create') return this.write(userId, input.data, actor, 'create');
    const existing = this.get(userId, input.recipeId);
    if (input.action === 'delete')
      return this.write(
        userId,
        recipeSchema.parse(this.input(existing)),
        actor,
        'delete',
        existing,
        true,
      );
    const recipe = this.write(userId, input.data, actor, input.action, existing);
    if (input.action === 'merge') {
      const source = this.get(userId, input.sourceId);
      this.write(userId, this.input(source), actor, 'merged', source, true);
    }
    return recipe;
  }
  input(recipe: Recipe): RecipeInput {
    const { id, version, createdAt, updatedAt, deletedAt, ...data } = recipe;
    return data;
  }
  mutate(
    userId: string,
    raw: unknown,
    actor: string,
    agent = false,
  ): { status: 'applied'; recipe: Recipe } | { status: 'pending'; changeId: string } {
    const input = changeSchema.parse(raw);
    return this.db.transaction(() => {
      this.validateChange(userId, input);
      if (agent && !this.user(userId).yolo) {
        const id = randomUUID();
        this.db
          .prepare('INSERT INTO changes(id,user_id,payload,key_name,created_at) VALUES (?,?,?,?,?)')
          .run(id, userId, JSON.stringify(input), actor, now());
        this.audit(userId, 'change.proposed', { changeId: id, action: input.action, actor });
        return { status: 'pending' as const, changeId: id };
      }
      return { status: 'applied' as const, recipe: this.apply(userId, input, actor) };
    })();
  }
  pendingCount(userId: string): number {
    return (
      this.db
        .prepare("SELECT count(*) AS count FROM changes WHERE user_id=? AND status='pending'")
        .get(userId) as { count: number }
    ).count;
  }
  changes(userId: string, limit = 500, offset = 0): Change[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM changes WHERE user_id=? ORDER BY (status='pending') DESC, created_at DESC, rowid DESC LIMIT ? OFFSET ?",
        )
        .all(userId, limit, offset) as any[]
    ).map((r) => ({
      recipeId: null,
      baseVersion: null,
      data: null,
      ...JSON.parse(r.payload),
      id: r.id,
      status: r.status,
      createdAt: r.created_at,
      keyName: r.key_name,
    }));
  }
  review(userId: string, id: string, approve: boolean) {
    return this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM changes WHERE user_id=? AND id=?')
        .get(userId, id) as any;
      if (!row) throw new AppError(404, 'Change not found.');
      if (row.status !== 'pending')
        throw new AppError(409, 'This change has already been reviewed.');
      const recipe = approve
        ? this.apply(
            userId,
            changeSchema.parse(JSON.parse(row.payload)),
            `human approval of ${row.key_name}`,
          )
        : null;
      this.db
        .prepare('UPDATE changes SET status=? WHERE id=?')
        .run(approve ? 'approved' : 'rejected', id);
      this.audit(userId, approve ? 'change.approved' : 'change.rejected', { changeId: id });
      return { recipe };
    })();
  }
  revisions(userId: string, id: string): Revision[] {
    this.get(userId, id, true);
    return (
      this.db
        .prepare('SELECT * FROM revisions WHERE user_id=? AND recipe_id=? ORDER BY version DESC')
        .all(userId, id) as any[]
    ).map((r) => ({
      id: r.id,
      recipeId: r.recipe_id,
      version: r.version,
      snapshot: JSON.parse(r.snapshot),
      action: r.action,
      actor: r.actor,
      createdAt: r.created_at,
    }));
  }
  restore(userId: string, id: string, revisionId: string, version: number) {
    return this.db.transaction(() => {
      const current = this.get(userId, id, true);
      if (current.version !== version)
        throw new AppError(409, 'Recipe changed. Reload before restoring.');
      const revision = this.revisions(userId, id).find((r) => r.id === revisionId);
      if (!revision) throw new AppError(404, 'Revision not found.');
      return this.write(userId, this.input(revision.snapshot), 'human', 'restore', current);
    })();
  }
  trash(userId: string) {
    return this.db
      .prepare(
        'SELECT * FROM recipes WHERE user_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC',
      )
      .all(userId)
      .map((r) => this.deserialize(r));
  }
  logs(userId: string) {
    return this.db
      .prepare(
        'SELECT id,event,detail,created_at AS createdAt FROM audit WHERE user_id=? ORDER BY rowid DESC LIMIT 200',
      )
      .all(userId);
  }
  duplicates(userId: string, id: string) {
    const target = this.get(userId, id);
    const names = new Set(target.ingredients.map((i) => i.ingredient.toLowerCase()));
    return this.search(userId, target.title)
      .filter((r) => r.id !== id)
      .map((recipe) => ({
        recipe,
        ingredientOverlap:
          recipe.ingredients.filter((i) => names.has(i.ingredient.toLowerCase())).length /
          Math.max(names.size, recipe.ingredients.length),
      }))
      .slice(0, 10);
  }
}
