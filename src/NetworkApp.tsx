import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Bookmark, Check, Clock3, Plus, Search, Shuffle } from 'lucide-react';
import { api, ApiError, post } from './api';
import { Bag, Modal, Notice } from './components';
import { type RecipeInput, type RecipeView, type SessionUser } from '../shared/atproto';
import { NetworkEditorPage } from './NetworkEditor';
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
const currentEditorRoute = () =>
  /^\/recipe\/(new|edit|adapt|draft)$/.test(location.pathname)
    ? location.pathname + location.search
    : null;
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
  const [editorRoute, setEditorRoute] = useState(currentEditorRoute);
  const leaveGuard = useRef<() => boolean>(() => true);
  const activeUrl = useRef(location.pathname + location.search);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string>();
  const refresh = () => setRevision((value) => value + 1);
  const go = (next: string | null) => {
    if (!leaveGuard.current()) return;
    const url = next ? recipeUrl(next) : '/';
    history.pushState(null, '', url);
    activeUrl.current = url;
    setEditorRoute(null);
    setUri(next);
    setError('');
    setChecked(new Set());
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const pop = () => {
      if (!leaveGuard.current()) {
        history.pushState(null, '', activeUrl.current);
        return;
      }
      activeUrl.current = location.pathname + location.search;
      setEditorRoute(currentEditorRoute());
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
    if (!ready || configured === null || editorRoute) return;
    if (!configured) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    setRecipe(null);
    if (uri) {
      api<RecipeView>(`/recipe?uri=${encodeURIComponent(uri)}${user ? `&fresh=${Date.now()}` : ''}`)
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
  }, [ready, configured, feed, search, uri, revision, user, editorRoute]);
  useEffect(() => {
    document.title = editorRoute
      ? `${editorRoute.startsWith('/recipe/new') ? 'Add a recipe' : 'Edit recipe'} — brownbag`
      : recipe && uri
        ? `${recipe.record.title} — brownbag`
        : 'brownbag — Your recipes. All in one bag.';
  }, [editorRoute, recipe, uri]);
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
  const edit = (data: Editing) => {
    if (!user) {
      setLogin(true);
      return;
    }
    if (!leaveGuard.current()) return;
    const url = data.original
      ? `/recipe/edit?uri=${encodeURIComponent(data.original.uri)}`
      : data.draftId
        ? `/recipe/draft?id=${encodeURIComponent(data.draftId)}`
        : data.data.derivedFrom
          ? `/recipe/adapt?uri=${encodeURIComponent(data.data.derivedFrom.uri)}`
          : '/recipe/new';
    history.pushState(null, '', url);
    activeUrl.current = url;
    setEditorRoute(url);
    setError('');
    window.scrollTo(0, 0);
  };
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
          <span>
            brownbag<span className="brand-period">.</span>
          </span>
        </a>
        <div className="network-actions">
          {user ? (
            <button
              className="network-account-button"
              onClick={() => setAccount(true)}
              aria-label="Open account settings"
              title={user.handle ? `@${user.handle}` : 'Account'}
            >
              {(user.handle?.replace(/^@/, '')[0] || 'A').toUpperCase()}
            </button>
          ) : (
            <button
              className="network-sign-in"
              disabled={!ready || configured !== true}
              onClick={() => setLogin(true)}
            >
              Sign in
            </button>
          )}
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
        ) : editorRoute ? (
          !ready ? (
            <p className="network-loading" role="status">
              Opening your cookbook…
            </p>
          ) : user ? (
            <NetworkEditorPage
              key={editorRoute}
              route={editorRoute}
              userDid={user.did}
              leaveGuard={leaveGuard}
              close={() => go(uri)}
              done={(result) => {
                setToast(result ? 'Recipe published' : 'Private draft saved');
                refresh();
                if (!result) setFeed('mine');
                go(result?.uri || null);
              }}
            />
          ) : (
            <section className="empty-state">
              <h1>Your next good recipe.</h1>
              <p>Sign in to create and edit your recipes.</p>
              <button className="button primary" onClick={() => setLogin(true)}>
                Sign in
              </button>
            </section>
          )
        ) : uri ? (
          <>
            <button className="text-button recipe-back" onClick={() => go(null)}>
              <ArrowLeft size={16} />
              Back to recipes
            </button>
            {loading ? (
              <p role="status" className="network-loading">
                Opening the cookbook…
              </p>
            ) : (
              recipe && (
                <article className="network-detail" lang={recipe.record.language}>
                  <p className="eyebrow">
                    FROM THE KITCHEN OF{' '}
                    {recipe.authorHandle ? `@${recipe.authorHandle}` : 'A COMMUNITY COOK'}
                  </p>
                  <h1>{recipe.record.title}</h1>
                  <p className="network-summary">{recipe.record.summary}</p>
                  <div className="recipe-facts">
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
                  </div>
                  <div className="network-actions network-detail-actions">
                    <button
                      className="button primary"
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
                    <details className="recipe-more-actions">
                      <summary>More options</summary>
                      <div className="stack">
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
                    </details>
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
                    <details className="recipe-disclosure recipe-story">
                      <summary>Story & cooking notes</summary>
                      <p className="network-prose">{recipe.record.description}</p>
                    </details>
                  )}
                  {!!recipe.record.tags?.length && (
                    <div className="recipe-tags">
                      {recipe.record.tags.map((tag, i) => (
                        <span key={i}>{tag}</span>
                      ))}
                    </div>
                  )}
                  {!!recipe.record.images?.length && (
                    <div className="recipe-gallery">
                      {recipe.record.images.map((photo, index) => (
                        <figure key={index}>
                          <img
                            src={`/api/recipe-image?${new URLSearchParams({ uri: recipe.uri, index: String(index) })}`}
                            alt={photo.alt}
                            loading="lazy"
                            width={photo.width}
                            height={photo.height}
                          />
                        </figure>
                      ))}
                    </div>
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
              <h1>
                Your recipes.
                <br />
                All in one{' '}
                <span className="network-bag-word">
                  bag.
                  <svg viewBox="0 0 210 14" preserveAspectRatio="none" aria-hidden="true">
                    <path
                      d="M3 10C55 0 142 1 204 8M11 12C70 6 141 6 196 11"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </h1>
              <div className="network-home-search">
                <form
                  className="network-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSearch(query);
                  }}
                >
                  <Search size={22} strokeWidth={1.7} />
                  <input
                    aria-label="Search recipes"
                    placeholder="Find a recipe, or start with an ingredient…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button className="network-search-submit" aria-label="Search" type="submit">
                    ↵
                  </button>
                </form>
                <div className="network-hero-actions">
                  <button
                    className="button primary"
                    disabled={loading || recipes.length === 0}
                    onClick={() => {
                      const item = recipes[Math.floor(Math.random() * recipes.length)];
                      if (item) go(item.uri);
                    }}
                  >
                    <Shuffle size={18} />
                    Surprise me
                  </button>
                  <button
                    className="button secondary"
                    disabled={configured !== true}
                    onClick={() => edit({ data: blank() })}
                  >
                    <Plus size={18} />
                    Add a recipe
                  </button>
                </div>
              </div>
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
                          <div className="network-card-body">
                            <div className="network-card-top">
                              <BookOpen size={22} strokeWidth={1.5} />
                              {(item.record.prepMinutes || 0) + (item.record.cookMinutes || 0) >
                                0 && (
                                <span>
                                  {(item.record.prepMinutes || 0) + (item.record.cookMinutes || 0)}{' '}
                                  min
                                </span>
                              )}
                            </div>
                            <h2>{item.record.title}</h2>
                            {item.record.summary && <p>{item.record.summary}</p>}
                            <div className="network-card-meta">
                              <span>{item.record.tags?.[0] || ''}</span>
                              <span>View recipe →</span>
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
                            ? 'Find your favourite cooks'
                            : feed === 'saved'
                              ? 'Keep the good ones close'
                              : feed === 'mine'
                                ? 'Every cookbook starts somewhere'
                                : 'A good recipe starts with you'}
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
      {toast && (
        <div className="network-toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {login && <LoginDialog close={() => setLogin(false)} />}
      {account && (
        <NetworkAccount
          onSignOut={async () => {
            if (!leaveGuard.current())
              throw new Error('Finish or save your recipe before signing out.');
            await post('/auth/logout', {});
            leaveGuard.current = () => true;
            setUser(null);
            setAccount(false);
            setFeed('discover');
            go(null);
            setToast('Signed out');
          }}
          close={() => {
            setAccount(false);
            refresh();
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
    <Modal title="Your cookbook starts here" close={close}>
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
