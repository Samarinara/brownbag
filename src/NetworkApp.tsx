import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Bookmark, Check, Clock3, Plus, Search } from 'lucide-react';
import { api, ApiError, post } from './api';
import { Bag, Modal, Notice } from './components';
import { type RecipeInput, type RecipeView, type SessionUser } from '../shared/atproto';
import { NetworkEditor } from './NetworkEditor';
import { NetworkAccount } from './NetworkAccount';
import './network.css';

type Feed = 'discover' | 'following' | 'mine' | 'saved';
type Draft = { id: string; data: RecipeInput; updatedAt: string };
export type Editing = { data: RecipeInput; original?: RecipeView; draftId?: string };
const blank = (): RecipeInput => ({
  title: '',
  ingredients: [{ name: '' }],
  instructions: [{ text: '' }],
});
const recipeUrl = (uri: string) => `/recipe?uri=${encodeURIComponent(uri)}`;
const currentUri = () => new URLSearchParams(location.search).get('uri');
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [feed, setFeed] = useState<Feed>('discover');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [uri, setUri] = useState(currentUri);
  const [recipes, setRecipes] = useState<RecipeView[]>([]);
  const [recipe, setRecipe] = useState<RecipeView | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [login, setLogin] = useState(false);
  const [account, setAccount] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string>();
  const refresh = () => setRevision((value) => value + 1);
  const go = (next: string | null) => {
    history.pushState(null, '', next ? recipeUrl(next) : '/');
    setUri(next);
    setError('');
    setChecked(new Set());
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const pop = () => {
      setUri(currentUri());
      setChecked(new Set());
    };
    window.addEventListener('popstate', pop);
    api<{ configured: boolean }>('/config')
      .then((data) => setConfigured(data.configured))
      .catch((e) => {
        setError(message(e));
        setLoading(false);
      });
    api<SessionUser>('/me')
      .then(setUser)
      .catch((e) => {
        if (!(e instanceof ApiError && (e.status === 401 || e.status === 503)))
          setError(message(e));
      })
      .finally(() => setReady(true));
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (!ready || configured === null) return;
    if (!configured) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    setRecipe(null);
    if (uri) {
      api<RecipeView>(`/recipe?uri=${encodeURIComponent(uri)}`)
        .then((data) => {
          if (alive) setRecipe(data);
        })
        .catch((e) => {
          if (alive) setError(message(e));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    } else {
      const params = new URLSearchParams({ feed, q: search, limit: '24' });
      Promise.all([
        api<{ recipes: RecipeView[]; nextCursor?: string }>(`/recipes?${params}`),
        feed === 'mine' && user
          ? api<{ drafts: Draft[] }>('/drafts')
          : Promise.resolve({ drafts: [] }),
      ])
        .then(([result, privateData]) => {
          if (alive) {
            setRecipes(result.recipes);
            setNextCursor(result.nextCursor);
            setDrafts(privateData.drafts);
          }
        })
        .catch((e) => {
          if (alive) {
            setRecipes([]);
            setDrafts([]);
            setNextCursor(undefined);
            setError(message(e));
          }
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }
    return () => {
      alive = false;
    };
  }, [ready, configured, feed, search, uri, revision, user]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const action = async (work: () => Promise<unknown>, success: string) => {
    if (!user) {
      setLogin(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await work();
      setToast(success);
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const selectFeed = (next: Feed) => {
    if (next !== 'discover' && !user) {
      setLogin(true);
      return;
    }
    setFeed(next);
    go(null);
  };
  const edit = (data: Editing) => (user ? setEditing(data) : setLogin(true));
  return (
    <div className="network-shell">
      <header className="network-header">
        <a
          href="/"
          className="network-brand"
          onClick={(e) => {
            e.preventDefault();
            selectFeed('discover');
          }}
        >
          <Bag small />
          brownbag<span>good food, shared.</span>
        </a>
        <div className="network-actions">
          {user && (
            <button className="button secondary" onClick={() => setAccount(true)}>
              Account
            </button>
          )}
          {user ? (
            <>
              <span className="network-handle" title={user.did}>
                {user.handle ? `@${user.handle}` : 'Your cookbook'}
              </span>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  void action(async () => {
                    await post('/auth/logout', {});
                    setUser(null);
                    setFeed('discover');
                    go(null);
                  }, 'Signed out');
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              className="button secondary"
              disabled={!ready || configured !== true}
              onClick={() => setLogin(true)}
            >
              Sign in
            </button>
          )}
          <button
            className="button primary"
            disabled={configured !== true}
            onClick={() => edit({ data: blank() })}
          >
            <Plus size={17} />
            Add a recipe
          </button>
        </div>
      </header>
      <main className="network-main">
        <Notice error={error} />
        {configured === false ? (
          <section className="empty-state">
            <Bag />
            <h1>A place for good food.</h1>
            <p>
              Brownbag is getting its kitchen ready. Account connections and the recipe library will
              be available once setup is complete.
            </p>
          </section>
        ) : uri ? (
          <>
            <button className="button secondary" onClick={() => go(null)}>
              <ArrowLeft size={16} />
              Back to recipes
            </button>
            {loading ? (
              <p role="status" className="network-loading">
                Opening the cookbook…
              </p>
            ) : (
              recipe && (
                <article className="network-detail">
                  <p className="eyebrow">
                    FROM THE KITCHEN OF{' '}
                    {recipe.authorHandle ? `@${recipe.authorHandle}` : 'A COMMUNITY COOK'}
                  </p>
                  <h1>{recipe.record.title}</h1>
                  <p className="network-summary">{recipe.record.summary}</p>
                  <div className="network-actions network-detail-actions">
                    {recipe.record.prepMinutes || recipe.record.cookMinutes ? (
                      <span>
                        <Clock3 size={16} />{' '}
                        {(recipe.record.prepMinutes || 0) + (recipe.record.cookMinutes || 0)} min
                      </span>
                    ) : null}
                    {recipe.record.yield && (
                      <span>
                        {recipe.record.yield.display ||
                          `${recipe.record.yield.quantity || ''} ${recipe.record.yield.unit || ''}`}
                      </span>
                    )}
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        void action(
                          () => post('/bookmarks', { uri: recipe.uri }),
                          'Saved to your cookbook',
                        );
                      }}
                    >
                      <Bookmark size={15} />
                      Save
                    </button>
                    <button
                      className="button secondary"
                      onClick={() =>
                        edit({
                          data: {
                            ...recipe.record,
                            title: `${recipe.record.title} — my take`,
                            derivedFrom: { uri: recipe.uri, cid: recipe.cid },
                          },
                        })
                      }
                    >
                      Make it your own
                    </button>
                    {user?.did === recipe.authorDid ? (
                      <>
                        <button
                          className="button secondary"
                          onClick={() => edit({ data: recipe.record, original: recipe })}
                        >
                          Edit recipe
                        </button>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                'Delete this published recipe? Copies saved by other people may remain.',
                              )
                            )
                              void action(async () => {
                                await api('/recipe', {
                                  method: 'DELETE',
                                  body: JSON.stringify({ uri: recipe.uri, cid: recipe.cid }),
                                });
                                go(null);
                              }, 'Recipe deleted');
                          }}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => {
                            void action(
                              () => post('/follows', { did: recipe.authorDid }),
                              'Following this cook',
                            );
                          }}
                        >
                          Follow cook
                        </button>
                        {user && (
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() =>
                              void action(
                                () =>
                                  api('/follows', {
                                    method: 'DELETE',
                                    body: JSON.stringify({ did: recipe.authorDid }),
                                  }),
                                'Stopped following this cook',
                              )
                            }
                          >
                            Stop following
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {recipe.record.derivedFrom && (
                    <p className="network-attribution">
                      Inspired by{' '}
                      <a
                        href={recipeUrl(recipe.record.derivedFrom.uri)}
                        onClick={(e) => {
                          e.preventDefault();
                          go(recipe.record.derivedFrom!.uri);
                        }}
                      >
                        this original recipe
                      </a>
                      . {recipe.record.adaptationNote}
                    </p>
                  )}
                  {recipe.record.source && (
                    <p>
                      Source:{' '}
                      {recipe.record.source.url &&
                      /^https?:\/\//i.test(recipe.record.source.url) ? (
                        <a href={recipe.record.source.url} target="_blank" rel="noreferrer">
                          {recipe.record.source.name || recipe.record.source.url}
                        </a>
                      ) : (
                        recipe.record.source.name
                      )}
                    </p>
                  )}
                  {recipe.record.description && (
                    <p className="network-prose">{recipe.record.description}</p>
                  )}
                  <div className="network-cooking">
                    <section>
                      <h2>Ingredients</h2>
                      <p className="muted">Tap each ingredient as you go.</p>
                      <ul className="network-ingredients">
                        {recipe.record.ingredients.map((ingredient, index) => (
                          <li key={index}>
                            <label className={checked.has(index) ? 'is-checked' : ''}>
                              <input
                                type="checkbox"
                                checked={checked.has(index)}
                                onChange={() =>
                                  setChecked((previous) => {
                                    const next = new Set(previous);
                                    if (next.has(index)) next.delete(index);
                                    else next.add(index);
                                    return next;
                                  })
                                }
                              />
                              <span>
                                {ingredient.group && <small>{ingredient.group} · </small>}
                                {[ingredient.quantity, ingredient.unit, ingredient.name]
                                  .filter(Boolean)
                                  .join(' ')}
                                {ingredient.preparation && `, ${ingredient.preparation}`}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </section>
                    <section>
                      <h2>Let’s cook</h2>
                      <ol className="network-steps">
                        {recipe.record.instructions.map((step, index) => (
                          <li key={index}>
                            {step.group && <strong>{step.group}</strong>}
                            <p>{step.text}</p>
                          </li>
                        ))}
                      </ol>
                    </section>
                  </div>
                </article>
              )
            )}
          </>
        ) : (
          <>
            <section className="network-hero">
              <p className="eyebrow">YOUR NEXT GOOD MEAL STARTS HERE</p>
              <h1>
                Recipes worth
                <br />
                <em>passing around.</em>
              </h1>
              <p>
                A cookbook made by all of us. Find something delicious,
                <br className="network-desktop" /> share a family favourite, and make it your own.
              </p>
            </section>
            <div className="network-toolbar">
              <nav aria-label="Recipe feeds">
                {(['discover', 'following', 'mine', 'saved'] as const).map((value) => (
                  <button
                    key={value}
                    className={feed === value ? 'active' : ''}
                    aria-current={feed === value ? 'page' : undefined}
                    onClick={() => selectFeed(value)}
                  >
                    {
                      {
                        discover: 'Discover',
                        following: 'Following',
                        mine: 'My cookbook',
                        saved: 'Saved',
                      }[value]
                    }
                  </button>
                ))}
              </nav>
              <form
                className="network-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearch(query);
                }}
              >
                <Search size={18} />
                <input
                  aria-label="Search recipes"
                  placeholder="Find your next favourite…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button className="icon-button" aria-label="Search" type="submit">
                  →
                </button>
              </form>
            </div>
            {loading ? (
              <p className="network-loading" role="status">
                Gathering recipes…
              </p>
            ) : (
              <>
                {feed === 'mine' && drafts.length > 0 && (
                  <section className="network-drafts">
                    <h2>Private drafts</h2>
                    <p>Only you can see these. Publish when you’re ready to share.</p>
                    {drafts.map((draft) => (
                      <div key={draft.id}>
                        <button
                          className="button secondary"
                          onClick={() => edit({ data: draft.data, draftId: draft.id })}
                        >
                          {draft.data.title || 'Untitled recipe'}
                        </button>
                        <button
                          className="icon-button"
                          disabled={busy}
                          aria-label={`Delete draft ${draft.data.title}`}
                          onClick={() => {
                            if (window.confirm('Delete this private draft?'))
                              void action(
                                () =>
                                  api(`/drafts/${encodeURIComponent(draft.id)}`, {
                                    method: 'DELETE',
                                  }),
                                'Draft deleted',
                              );
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </section>
                )}
                {recipes.length ? (
                  <div className="network-grid">
                    {recipes.map((item) => (
                      <article className="network-card" key={item.uri}>
                        <a
                          href={recipeUrl(item.uri)}
                          onClick={(e) => {
                            e.preventDefault();
                            go(item.uri);
                          }}
                        >
                          <div className="network-card-art">
                            <BookOpen size={42} strokeWidth={1} />
                            <span>{item.record.tags?.[0] || 'FROM THE COMMUNITY'}</span>
                          </div>
                          <div className="network-card-body">
                            <p className="eyebrow">
                              {item.authorHandle ? `@${item.authorHandle}` : 'A COMMUNITY COOK'}
                            </p>
                            <h2>{item.record.title}</h2>
                            <p>
                              {item.record.summary ||
                                `${item.record.ingredients.length} ingredients. A little inspiration for your kitchen.`}
                            </p>
                            <div className="network-card-meta">
                              <span>
                                {(item.record.prepMinutes || 0) + (item.record.cookMinutes || 0)
                                  ? `${(item.record.prepMinutes || 0) + (item.record.cookMinutes || 0)} min`
                                  : 'Made to share'}
                              </span>
                              <span>View recipe ↗</span>
                            </div>
                          </div>
                        </a>
                        {feed === 'saved' && (
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() => {
                              void action(
                                () =>
                                  api('/bookmarks', {
                                    method: 'DELETE',
                                    body: JSON.stringify({ uri: item.uri }),
                                  }),
                                'Removed from saved',
                              );
                            }}
                          >
                            Remove from saved
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  !error && (
                    <section className="empty-state compact">
                      <BookOpen size={38} />
                      <h2>
                        {search
                          ? 'No recipes found'
                          : feed === 'following'
                            ? 'Your table is waiting'
                            : feed === 'saved'
                              ? 'Keep the good ones close'
                              : feed === 'mine'
                                ? 'Every cookbook starts somewhere'
                                : 'Be the first to pass something around'}
                      </h2>
                      <p>
                        {search
                          ? 'Try another ingredient or title.'
                          : feed === 'following'
                            ? 'Follow a cook from their recipe to see what they share here.'
                            : feed === 'saved'
                              ? 'Save a recipe and it will be waiting here for your next meal.'
                              : 'Share a recipe you love, or start with a private draft.'}
                      </p>
                    </section>
                  )
                )}
                {nextCursor && (
                  <button
                    className="button secondary network-load-more"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const result = await api<{ recipes: RecipeView[]; nextCursor?: string }>(
                          `/recipes?${new URLSearchParams({ feed, q: search, cursor: nextCursor, limit: '24' })}`,
                        );
                        setRecipes((old) => [
                          ...old,
                          ...result.recipes.filter((r) => !old.some((o) => o.uri === r.uri)),
                        ]);
                        setNextCursor(result.nextCursor);
                      } catch (e) {
                        setError(message(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    More recipes
                  </button>
                )}
              </>
            )}
          </>
        )}
      </main>
      <footer className="network-footer">
        <Bag small />
        <span>A little inspiration. A lot of good food.</span>
        <span>Recipes belong to their cooks.</span>
      </footer>
      {toast && (
        <div className="network-toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {login && <LoginDialog close={() => setLogin(false)} />}
      {account && (
        <NetworkAccount
          close={() => {
            setAccount(false);
            refresh();
          }}
        />
      )}
      {editing && (
        <NetworkEditor
          editing={editing}
          close={() => setEditing(null)}
          done={(result) => {
            setEditing(null);
            setToast(result ? 'Recipe published' : 'Private draft saved');
            refresh();
            if (result) go(result.uri);
            else {
              setFeed('mine');
              go(null);
            }
          }}
        />
      )}
    </div>
  );
}

function LoginDialog({ close }: { close: () => void }) {
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Welcome to the table" close={close}>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const result = await post<{ url: string }>('/auth/login', {
              handle: handle.trim().replace(/^@/, ''),
            });
            location.assign(result.url);
          } catch (e) {
            setError(message(e));
            setBusy(false);
          }
        }}
      >
        <p>
          Bring your existing Bluesky or compatible account. Your recipes stay connected to you
          wherever you go.
        </p>
        <label>
          Your handle
          <input
            autoFocus
            required
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="you.bsky.social or your domain"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>
        <p className="muted">
          You’ll sign in securely with your account provider. Brownbag never sees your password.
        </p>
        <Notice error={error} />
        <button className="button primary" disabled={busy}>
          {busy ? 'Opening sign in…' : 'Continue'}
        </button>
      </form>
    </Modal>
  );
}
