import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  Check,
  Clock3,
  Plus,
  Search,
  Shuffle,
  Tags,
} from 'lucide-react';
import { api, ApiError, post } from './api';
import { Bag, Modal, Notice } from './components';
import { type RecipeInput, type RecipeView, type SessionUser } from '../shared/atproto';
import { NetworkEditorPage } from './NetworkEditor';
import { NetworkAccount } from './NetworkAccount';
import './network.css';

type Feed = 'discover' | 'following' | 'cookbook';
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
  const [feed, setFeed] = useState<Feed>(
    location.pathname === '/cookbook' ? 'cookbook' : 'discover',
  );
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [entry, setEntry] = useState<{ saved: boolean; tags: string[] } | null>(null);
  const [tagSelector, setTagSelector] = useState(false);
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
  const pageRequest = useRef(0);
  const refresh = () => setRevision((value) => value + 1);
  const go = (next: string | null, destination = feed) => {
    if (!leaveGuard.current()) return;
    const url = next ? recipeUrl(next) : destination === 'cookbook' ? '/cookbook' : '/';
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
      if (!currentUri()) setFeed(location.pathname === '/cookbook' ? 'cookbook' : 'discover');
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
    pageRequest.current += 1;
    setLoading(true);
    setError('');
    setRecipe(null);
    setEntry(null);
    if (uri) {
      Promise.all([
        api<RecipeView>(
          `/recipe?uri=${encodeURIComponent(uri)}${user ? `&fresh=${Date.now()}` : ''}`,
        ),
        user
          ? api<{ saved: boolean; tags: string[] }>(
              `/cookbook/entry?uri=${encodeURIComponent(uri)}`,
            )
          : Promise.resolve(null),
      ])
        .then(([data, saved]) => {
          if (alive) {
            setRecipe(data);
            setEntry(saved);
          }
        })
        .catch((e) => {
          if (alive) setError(message(e));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    } else {
      const params = new URLSearchParams({
        feed,
        q: search,
        ...(feed === 'cookbook' && tag ? { tag } : {}),
        limit: '24',
      });
      Promise.all([
        api<{ recipes: RecipeView[]; nextCursor?: string }>(`/recipes?${params}`),
        feed === 'cookbook' && user
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
      pageRequest.current += 1;
    };
  }, [ready, configured, feed, search, uri, revision, user, tag, editorRoute]);
  useEffect(() => {
    document.title = editorRoute
      ? `${editorRoute.startsWith('/recipe/new') ? 'Add a recipe' : 'Edit recipe'} — brownbag`
      : recipe && uri
        ? `${recipe.record.title} — brownbag`
        : 'brownbag — Your recipes. All in one bag.';
  }, [editorRoute, recipe, uri]);
  useEffect(() => {
    if (!user) {
      setTags([]);
      return;
    }
    let alive = true;
    api<{ tags: string[] }>('/cookbook/tags')
      .then((result) => {
        if (alive) setTags(result.tags);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    return () => {
      alive = false;
    };
  }, [user, revision]);
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
    setQuery('');
    setSearch('');
    setTag('');
    go(null, next);
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
          <a
            href="/cookbook"
            className="network-cookbook-link"
            aria-current={feed === 'cookbook' && !uri ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              selectFeed('cookbook');
            }}
          >
            Cookbook
          </a>
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
                if (result) go(result.uri);
                else {
                  setFeed('cookbook');
                  go(null, 'cookbook');
                }
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
              {feed === 'cookbook' ? 'Back to cookbook' : 'Back to recipes'}
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
                      disabled={busy || (!!user && !entry)}
                      aria-label={entry?.saved ? 'Remove from cookbook' : 'Save to cookbook'}
                      onClick={() => {
                        if (!user) {
                          setLogin(true);
                          return;
                        }
                        if (entry?.saved)
                          void action(
                            () =>
                              api('/bookmarks', {
                                method: 'DELETE',
                                body: JSON.stringify({ uri: recipe.uri }),
                              }),
                            'Removed from your cookbook',
                          );
                        else setTagSelector(true);
                      }}
                    >
                      {entry?.saved ? <Check size={15} /> : <Bookmark size={15} />}
                      {entry?.saved ? 'Saved' : 'Save'}
                    </button>
                    {entry?.saved && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setTagSelector(true)}
                      >
                        <Tags size={15} />
                        Tags
                      </button>
                    )}
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
            <section className={feed === 'cookbook' ? 'network-cookbook-heading' : 'network-hero'}>
              {feed === 'cookbook' ? (
                <h1>Cookbook</h1>
              ) : (
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
              )}
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
                  {feed !== 'cookbook' && (
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
                  )}
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
            {feed === 'cookbook' && (
              <nav className="network-tag-chits" aria-label="Filter cookbook by tag">
                {['', ...tags].map((value) => (
                  <button
                    key={value}
                    className={tag === value ? 'active' : ''}
                    aria-pressed={tag === value}
                    onClick={() => setTag(value)}
                  >
                    {value || 'All'}
                  </button>
                ))}
              </nav>
            )}
            {feed !== 'cookbook' && (
              <div className="network-toolbar">
                <nav aria-label="Recipe feeds">
                  {(['discover', 'following'] as const).map((value) => (
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
                        }[value]
                      }
                    </button>
                  ))}
                </nav>
              </div>
            )}
            {loading ? (
              <p className="network-loading" role="status">
                Gathering recipes…
              </p>
            ) : (
              <>
                {feed === 'cookbook' && !search && !tag && drafts.length > 0 && (
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
                  <div className={feed === 'cookbook' ? 'network-cookbook-list' : 'network-grid'}>
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
                              <span>
                                {feed === 'cookbook'
                                  ? item.cookbookTags?.join(' · ')
                                  : item.record.tags?.[0] || ''}
                              </span>
                              <span>
                                {feed === 'cookbook' && item.cookbookAddedAt
                                  ? new Date(item.cookbookAddedAt).toLocaleDateString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric',
                                    })
                                  : 'View recipe →'}
                              </span>
                            </div>
                          </div>
                        </a>
                      </article>
                    ))}
                  </div>
                ) : (
                  !error && (
                    <section className="empty-state compact">
                      <BookOpen size={38} />
                      <h2>
                        {search || tag
                          ? 'No recipes found'
                          : feed === 'following'
                            ? 'Find your favourite cooks'
                            : feed === 'cookbook'
                              ? 'Every cookbook starts somewhere'
                              : 'A good recipe starts with you'}
                      </h2>
                      <p>
                        {search || tag
                          ? 'Try another tag, ingredient or title.'
                          : feed === 'following'
                            ? 'Follow a cook from their recipe to see what they share here.'
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
                      const request = pageRequest.current;
                      try {
                        const result = await api<{ recipes: RecipeView[]; nextCursor?: string }>(
                          `/recipes?${new URLSearchParams({ feed, q: search, ...(feed === 'cookbook' && tag ? { tag } : {}), cursor: nextCursor, limit: '24' })}`,
                        );
                        if (request !== pageRequest.current) return;
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
      {tagSelector && recipe && (
        <TagDialog
          existing={tags}
          selected={entry?.tags || []}
          saved={!!entry?.saved}
          close={() => setTagSelector(false)}
          done={async (selected) => {
            await post('/bookmarks', { uri: recipe.uri, tags: selected });
            setTagSelector(false);
            setToast(entry?.saved ? 'Tags updated' : 'Saved to your cookbook');
            refresh();
          }}
        />
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
            go(null, 'discover');
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

function TagDialog({
  existing,
  selected,
  saved,
  close,
  done,
}: {
  existing: string[];
  selected: string[];
  saved: boolean;
  close: () => void;
  done: (tags: string[]) => Promise<void>;
}) {
  const [choices, setChoices] = useState([...new Set([...existing, ...selected])]);
  const [selection, setSelection] = useState(selected);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const value = choices.find((tag) => tag.toLowerCase() === trimmed.toLowerCase()) || trimmed;
    setChoices((old) => [...new Set([...old, value])]);
    setSelection((old) => [...new Set([...old, value])]);
    setName('');
  };
  return (
    <Modal
      title={saved ? 'Recipe tags' : 'Save to cookbook'}
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const trimmed = name.trim();
            const value =
              choices.find((tag) => tag.toLowerCase() === trimmed.toLowerCase()) || trimmed;
            await done([...new Set([...selection, ...(value ? [value] : [])])]);
          } catch (e) {
            setError(message(e));
            setBusy(false);
          }
        }}
      >
        <fieldset className="network-tag-options" disabled={busy}>
          <legend>Choose tags</legend>
          <div className="network-tag-chits">
            {choices.map((tag) => (
              <button
                type="button"
                key={tag}
                aria-pressed={selection.includes(tag)}
                className={selection.includes(tag) ? 'active' : ''}
                onClick={() =>
                  setSelection((old) =>
                    old.includes(tag) ? old.filter((value) => value !== tag) : [...old, tag],
                  )
                }
              >
                {tag}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          New tag <span className="muted">(25 characters max)</span>
          <div className="network-new-tag">
            <input
              maxLength={25}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button
              type="button"
              className="button secondary"
              disabled={busy || !name.trim()}
              onClick={add}
            >
              Add
            </button>
          </div>
        </label>
        <Notice error={error} />
        <button className="button primary" disabled={busy}>
          {busy ? 'Saving…' : saved ? 'Done' : 'Save recipe'}
        </button>
      </form>
    </Modal>
  );
}
