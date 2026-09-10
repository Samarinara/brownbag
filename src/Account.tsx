import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Plus, Trash2, ShieldCheck, Zap } from 'lucide-react';
import { api, post } from './api';
import { Modal, Notice } from './components';
import type { Change, Recipe, RecipeInput, Revision, User } from '../shared/schema';

export function RecipeSummary({ recipe }: { recipe: RecipeInput }) {
  return (
    <div className="recipe-summary">
      <h3>{recipe.title}</h3>
      <p>{recipe.shortDescription}</p>
      {recipe.longDescription && <p>{recipe.longDescription}</p>}
      <p className="hint">
        Serves {recipe.servings ?? '—'} · Prep {recipe.prepMinutes ?? '—'} min · Cook{' '}
        {recipe.cookMinutes ?? '—'} min
      </p>
      <h4>Ingredients</h4>
      <ul>
        {recipe.ingredients.map((i, n) => (
          <li key={n}>
            {[i.quantity, i.unit, i.ingredient].filter((v) => v !== null && v !== '').join(' ')}
            {i.note && ` (${i.note})`}
          </li>
        ))}
      </ul>
      <h4>Steps</h4>
      <ol>
        {recipe.steps.map((s, i) => (
          <li key={i}>{s.text}</li>
        ))}
      </ol>
      <p>{recipe.tags.join(' · ')}</p>
      {recipe.notes && <p>Notes: {recipe.notes}</p>}
      {recipe.sourceUrl && <p>Source: {recipe.sourceUrl}</p>}
      {Object.keys(recipe.metadata).length > 0 && (
        <pre>{JSON.stringify(recipe.metadata, null, 2)}</pre>
      )}
    </div>
  );
}
export function Account({
  user,
  update,
  close,
  logout,
}: {
  user: User;
  update: (u: User) => void;
  close: () => void;
  logout: () => void;
}) {
  const [keys, setKeys] = useState<
    { id: string; name: string; prefix: string; createdAt: string }[]
  >([]);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'agents' | 'activity' | 'trash'>('agents');
  const [logs, setLogs] = useState<
    { id: string; event: string; detail: string; createdAt: string }[]
  >([]);
  const [trash, setTrash] = useState<Recipe[]>([]);
  const load = async () => {
    const [keys, logs, trash] = await Promise.all([
      api<keysType>('/keys'),
      api<logsType>('/audit'),
      api<Recipe[]>('/trash'),
    ]);
    setKeys(keys);
    setLogs(logs);
    setTrash(trash);
  };
  type keysType = typeof keys;
  type logsType = typeof logs;
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Your brownbag" close={close} wide>
      <div className="account-identity">
        <span className="avatar">{user.email[0].toUpperCase()}</span>
        <div>
          <strong>{user.email}</strong>
          <p className="hint">Your recipes are private. Only you and your API keys have access.</p>
        </div>
      </div>
      <div className="tabs">
        {(['agents', 'activity', 'trash'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'agents'
              ? 'Agents & API keys'
              : t === 'activity'
                ? 'Activity log'
                : 'Recently deleted'}
          </button>
        ))}
      </div>
      <Notice error={error} />
      {tab === 'agents' && (
        <div className="stack">
          <div className={`yolo-panel ${user.yolo ? 'enabled' : ''}`}>
            <div className="inline">
              {user.yolo ? <Zap size={22} /> : <ShieldCheck size={22} />}
              <strong>YOLO mode</strong>
              <span className="badge">{user.yolo ? 'On' : 'Off by default'}</span>
            </div>
            <p className="muted">
              {user.yolo
                ? 'All your API keys can change recipes immediately. Every change is still saved in history.'
                : 'Agent additions, edits, merges, and deletions wait for your approval.'}
            </p>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={user.yolo}
                disabled={busy}
                onChange={(e) => {
                  const yolo = e.target.checked;
                  void run(async () =>
                    update(
                      await api<User>('/me', { method: 'PATCH', body: JSON.stringify({ yolo }) }),
                    ),
                  );
                }}
              />
              <span>Let my agents make changes without review</span>
            </label>
            <p className="hint">
              Applies to all your keys. Existing pending changes still need review.
            </p>
          </div>
          <div>
            <h3>Connect an agent</h3>
            <p className="muted">Use this Streamable HTTP MCP endpoint with a Bearer API key.</p>
            <code className="endpoint">{location.origin}/mcp</code>
            <details>
              <summary>Connection configuration</summary>
              <pre>
                {JSON.stringify(
                  {
                    mcpServers: {
                      brownbag: {
                        type: 'http',
                        url: `${location.origin}/mcp`,
                        headers: { Authorization: 'Bearer YOUR_API_KEY' },
                      },
                    },
                  },
                  null,
                  2,
                )}
              </pre>
              <p className="hint">
                Client configuration formats vary. Set the endpoint and Authorization header in your
                MCP client.
              </p>
            </details>
          </div>
          <form
            className="key-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await post<{ token: string }>('/keys', { name });
                setToken(result.token);
                setCopied(false);
                setName('');
              });
            }}
          >
            <label>
              New API key
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My recipe assistant"
              />
            </label>
            <button className="button primary" disabled={busy}>
              <Plus size={16} />
              Create key
            </button>
          </form>
          {token && (
            <div className="new-key">
              <strong>Copy your key now. It won’t be shown again.</strong>
              <code>{token}</code>
              <button
                className="text-button"
                onClick={() => {
                  navigator.clipboard
                    .writeText(token)
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError('Copy unavailable. Select the key and copy it manually.'),
                    );
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy key'}
              </button>
            </div>
          )}
          <div className="key-list">
            {keys.map((k) => (
              <div key={k.id}>
                <KeyRound size={18} />
                <div>
                  <strong>{k.name}</strong>
                  <p className="hint">
                    {k.prefix}… · Created {new Date(k.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  className="icon-button danger"
                  aria-label={`Revoke ${k.name}`}
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Revoke “${k.name}”? Agents using this key will lose access.`))
                      void run(async () => {
                        await api(`/keys/${k.id}`, { method: 'DELETE' });
                        setToken('');
                      });
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
            {!keys.length && (
              <p className="empty-note">
                No API keys yet. Create one to invite an agent into your kitchen.
              </p>
            )}
          </div>
        </div>
      )}
      {tab === 'activity' && (
        <div className="activity-list">
          <p className="hint">The latest 200 events. All events remain stored in the database.</p>
          {logs.map((l) => (
            <details key={l.id}>
              <summary>
                {l.event.replaceAll('.', ' · ').replaceAll('_', ' ')}
                <time>{new Date(l.createdAt).toLocaleString()}</time>
              </summary>
              <pre>{JSON.stringify(JSON.parse(l.detail), null, 2)}</pre>
            </details>
          ))}
        </div>
      )}
      {tab === 'trash' && (
        <div className="stack">
          <p className="muted">
            Deleted recipes keep their full history. Restore one to bring it back to your
            collection.
          </p>
          {trash.map((r) => (
            <div className="trash-row" key={r.id}>
              <div>
                <strong>{r.title}</strong>
                <p className="hint">Deleted {new Date(r.deletedAt!).toLocaleDateString()}</p>
              </div>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const history = await api<Revision[]>(`/recipes/${r.id}/history`);
                    await post(`/recipes/${r.id}/restore`, {
                      revisionId: history[0].id,
                      baseVersion: r.version,
                    });
                  })
                }
              >
                Restore
              </button>
            </div>
          ))}
          {!trash.length && (
            <p className="empty-note">Nothing in the compost. No deleted recipes.</p>
          )}
        </div>
      )}
      <div className="modal-footer">
        <button
          className="text-button danger"
          onClick={() =>
            void run(async () => {
              await post('/auth/logout', {});
              logout();
            })
          }
        >
          Sign out
        </button>
        <button className="button secondary" onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  );
}

export function Reviews({ close, changed }: { close: () => void; changed: () => void }) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [before, setBefore] = useState<Record<string, Recipe>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  async function load() {
    const changes = await api<Change[]>('/changes');
    setChanges(changes);
    const ids = [
      ...new Set(
        changes
          .filter((c) => c.status === 'pending')
          .flatMap((c) => [c.recipeId, c.sourceId].filter((id): id is string => !!id)),
      ),
    ];
    const recipes = await Promise.all(
      ids.map((id) => api<Recipe>(`/recipes/${id}`).catch(() => null)),
    );
    setBefore(Object.fromEntries(recipes.filter((r): r is Recipe => !!r).map((r) => [r.id, r])));
  }
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function review(id: string, approve: boolean) {
    setError('');
    setBusy(true);
    try {
      await post(`/changes/${id}/review`, { approve });
      await load();
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const pending = changes.filter((c) => c.status === 'pending');
  return (
    <Modal title="A second pair of eyes" close={close} wide>
      <p className="muted">
        Your agents have done the prep. Review their changes before they enter your collection.
      </p>
      <Notice error={error} />
      {loading ? (
        <p>Loading changes…</p>
      ) : !pending.length ? (
        <div className="empty-state compact">
          <ShieldCheck size={38} />
          <h3>All caught up</h3>
          <p>Agent proposals will appear here for your review.</p>
        </div>
      ) : (
        pending.map((c) => (
          <details className="proposal" key={c.id}>
            <summary>
              <span>
                <span className="badge">{c.action}</span>
                <strong>
                  {c.data?.title ||
                    (c.recipeId && before[c.recipeId]?.title) ||
                    'Recipe removed or unavailable'}
                </strong>
                <small>
                  {c.keyName} · {new Date(c.createdAt).toLocaleString()}
                </small>
              </span>
            </summary>
            <div className="proposal-body">
              {c.recipeId && (
                <>
                  <h4>Current recipe</h4>
                  {before[c.recipeId] ? (
                    <RecipeSummary recipe={before[c.recipeId]} />
                  ) : (
                    <p className="error">
                      This recipe is no longer available. Reject this proposal.
                    </p>
                  )}
                  {before[c.recipeId]?.version !== c.baseVersion && (
                    <p className="error">
                      The recipe has changed since this proposal was made. Approval will be blocked;
                      ask your agent to submit a fresh proposal.
                    </p>
                  )}
                </>
              )}
              {c.sourceId && (
                <>
                  <h4>Merge source (will be deleted)</h4>
                  {before[c.sourceId] ? (
                    <RecipeSummary recipe={before[c.sourceId]} />
                  ) : (
                    <p className="error">Source recipe is no longer available.</p>
                  )}
                </>
              )}
              {c.data && (
                <>
                  <h4>Proposed recipe</h4>
                  <RecipeSummary recipe={c.data} />
                </>
              )}
              {c.action === 'delete' && (
                <p className="error">
                  This recipe will be moved to recently deleted. Its history will be retained.
                </p>
              )}
              <div className="modal-footer">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void review(c.id, false)}
                >
                  Reject
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void review(c.id, true)}
                >
                  <Check size={16} />
                  Approve change
                </button>
              </div>
            </div>
          </details>
        ))
      )}
    </Modal>
  );
}

export function History({
  recipe,
  close,
  restored,
}: {
  recipe: Recipe;
  close: () => void;
  restored: (r: Recipe) => void;
}) {
  const [history, setHistory] = useState<Revision[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Revision[]>(`/recipes/${recipe.id}/history`)
      .then(setHistory)
      .catch((e) => setError(e.message));
  }, [recipe.id]);
  return (
    <Modal title="Recipe history" close={close} wide>
      <p className="muted">Every version of {recipe.title}, kept for safekeeping.</p>
      <Notice error={error} />
      {history.map((r) => (
        <details className="proposal" key={r.id}>
          <summary>
            <span>
              <strong>
                Version {r.version} {r.version === recipe.version && '· Current'}
              </strong>
              <small>
                {r.action} · {r.actor} · {new Date(r.createdAt).toLocaleString()}
              </small>
            </span>
          </summary>
          <div className="proposal-body">
            <RecipeSummary recipe={r.snapshot} />
            {r.version !== recipe.version && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    restored(
                      await post<Recipe>(`/recipes/${recipe.id}/restore`, {
                        revisionId: r.id,
                        baseVersion: recipe.version,
                      }),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Restore this version
              </button>
            )}
          </div>
        </details>
      ))}
    </Modal>
  );
}
