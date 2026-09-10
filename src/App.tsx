import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  History as HistoryIcon,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Shuffle,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError, post } from './api';
import { Bag, Login, Notice, RecipeEditor } from './components';
import { Account, History, Reviews } from './Account';
import type { Recipe, User } from '../shared/schema';

type Page = { path: string; query: string; tag: string };
const currentPage = (): Page => ({
  path: location.pathname,
  query: new URLSearchParams(location.search).get('q') || '',
  tag: new URLSearchParams(location.search).get('tag') || '',
});
type Stats = { recipes: number; tags: string[]; pending: number };
const formatQuantity = (n: number | null) => {
  if (n === null) return '';
  const whole = Math.floor(n);
  const fraction = new Map([
    [0.25, '¼'],
    [0.5, '½'],
    [0.75, '¾'],
    [0.333, '⅓'],
    [0.667, '⅔'],
  ]).get(Math.round((n - whole) * 1000) / 1000);
  return fraction ? `${whole || ''}${fraction}` : String(n);
};

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState(currentPage);
  const [query, setQuery] = useState(page.query);
  const [modal, setModal] = useState<
    'login' | 'add' | 'edit' | 'account' | 'reviews' | 'history' | null
  >(null);
  const [stats, setStats] = useState<Stats>({ recipes: 0, tags: [], pending: 0 });
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [total, setTotal] = useState(0);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [suggestions, setSuggestions] = useState<Recipe[]>([]);
  const [focused, setFocused] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const go = useCallback((path: string) => {
    history.pushState(null, '', path);
    setPage(currentPage());
    setError('');
    setFocused(false);
    window.scrollTo({ top: 0 });
  }, []);
  const refresh = () => setRevision((r) => r + 1);
  useEffect(() => {
    const pop = () => setPage(currentPage());
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    api<User>('/me')
      .then(setUser)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) setError(e.message);
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    setQuery(page.query);
    setChecked(new Set());
  }, [page]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    setLoading(true);
    setError('');
    api<Stats>('/stats')
      .then((s) => {
        if (alive) setStats(s);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    const request = page.path.startsWith('/recipes/')
      ? api<Recipe>(page.path).then((r) => {
          if (alive) setRecipe(r);
        })
      : api<{ total: number; recipes: Recipe[] }>(
          `/recipes?q=${encodeURIComponent(page.query)}&tag=${encodeURIComponent(page.tag)}&limit=${page.path === '/' ? 6 : 24}`,
        ).then((r) => {
          if (alive) {
            setRecipes(r.recipes);
            setTotal(r.total);
          }
        });
    request
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setRecipe(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user, page, revision]);
  useEffect(() => {
    setSelected(-1);
    if (!user || !query.trim() || !focused) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<{ recipes: Recipe[] }>(`/recipes?mode=title&q=${encodeURIComponent(query)}&limit=5`, {
        signal: controller.signal,
      })
        .then((r) => setSuggestions(r.recipes))
        .catch(() => {});
    }, 140);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, focused, user]);
  function requireUser(action: () => void) {
    if (user) action();
    else setModal('login');
  }
  async function random(filtered = false) {
    if (!user) {
      setModal('login');
      return;
    }
    setError('');
    try {
      const r = await api<Recipe>(
        `/recipes/random${filtered ? `?q=${encodeURIComponent(page.query)}&tag=${encodeURIComponent(page.tag)}` : ''}`,
      );
      go(`/recipes/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function saved(r: Recipe) {
    setModal(null);
    refresh();
    setRecipe(r);
    go(`/recipes/${r.id}`);
    setToast('Recipe tucked away.');
  }
  const isHome = page.path === '/';
  const isSearch = page.path === '/search';
  const isDetail = page.path.startsWith('/recipes/');
  const searchBox = (
    <form
      className={`search-form ${isHome ? '' : 'search-small'}`}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        requireUser(() => {
          if (selected >= 0 && suggestions[selected]) go(`/recipes/${suggestions[selected].id}`);
          else go(`/search?q=${encodeURIComponent(query)}`);
          setFocused(false);
        });
      }}
    >
      <div className="search-input-wrap">
        <Search size={22} strokeWidth={1.7} />
        <input
          ref={searchInput}
          aria-label="Search recipes"
          role="combobox"
          aria-expanded={focused && suggestions.length > 0}
          aria-controls="search-suggestions"
          aria-autocomplete="list"
          aria-activedescendant={selected >= 0 ? `suggestion-${selected}` : undefined}
          placeholder="Find a recipe, or start with an ingredient…"
          maxLength={200}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, suggestions.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, -1));
            }
            if (e.key === 'Escape') setFocused(false);
          }}
        />
        {query ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              searchInput.current?.focus();
            }}
          >
            <X size={17} />
          </button>
        ) : (
          <kbd>↵</kbd>
        )}
      </div>
      {focused && suggestions.length > 0 && (
        <div className="suggestions" role="listbox" id="search-suggestions">
          <span className="eyebrow">Recipe matches</span>
          {suggestions.map((r, i) => (
            <button
              role="option"
              aria-selected={selected === i}
              id={`suggestion-${i}`}
              type="button"
              key={r.id}
              className={selected === i ? 'selected' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(`/recipes/${r.id}`)}
            >
              <BookOpen size={16} />
              <span>{r.title}</span>
              <ArrowRight size={15} />
            </button>
          ))}
          <div className="suggestions-footer">Press Enter to search titles & ingredients</div>
        </div>
      )}
    </form>
  );
  return (
    <div className="app-shell">
      <header className="site-header">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go('/');
          }}
        >
          <Bag small />
          <span>
            brownbag<span className="brand-period">.</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {user ? (
            <>
              <button className="nav-link" onClick={() => go('/search')}>
                My recipes <span className="count">{stats.recipes}</span>
              </button>
              <button className="nav-link review-link" onClick={() => setModal('reviews')}>
                <ShieldCheck size={17} />
                <span>Review</span>
                {stats.pending > 0 && <span className="notification">{stats.pending}</span>}
              </button>
              <button
                className="account-button"
                onClick={() => setModal('account')}
                aria-label="Account and agent settings"
              >
                {user.email[0].toUpperCase()}
              </button>
            </>
          ) : (
            <>
              <button className="nav-link" disabled={!ready} onClick={() => setModal('login')}>
                Sign in <ArrowRight size={15} />
              </button>
            </>
          )}
        </nav>
      </header>
      <main className={isHome ? 'home-main' : 'inner-main'}>
        {isHome && (
          <>
            <section className="hero">
              <h1>
                Your recipes.
                <br />
                All in one{' '}
                <span className="bag-word">
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
              <div className="home-search">
                {searchBox}
                <div className="hero-actions">
                  <button className="button primary" onClick={() => void random()}>
                    <Shuffle size={18} />
                    Surprise me
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => requireUser(() => setModal('add'))}
                  >
                    <Plus size={20} />
                    Add a recipe
                  </button>
                </div>
              </div>
            </section>
            <Notice error={error} />
            {user && stats.recipes > 0 ? (
              <section className="recent-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">FROM YOUR COLLECTION</span>
                    <h2>Freshly tucked away</h2>
                  </div>
                  <button className="text-button" onClick={() => go('/search')}>
                    View all recipes
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="recipe-grid">
                  {recipes.map((r) => (
                    <RecipeCard key={r.id} recipe={r} open={() => go(`/recipes/${r.id}`)} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
        {!isHome && (
          <>
            <div className="breadcrumb">
              <button className="text-button" onClick={() => go('/')}>
                <ArrowLeft size={15} />
                Back to the bag
              </button>
              {isDetail && (
                <button className="text-button" onClick={() => go('/search')}>
                  All recipes
                  <ChevronRight size={15} />
                </button>
              )}
            </div>
            {!user ? (
              <div className="empty-state">
                <LockKeyhole size={34} />
                <h1>Your recipes are just for you.</h1>
                <p>Sign in to open your private collection.</p>
                <button className="button primary" onClick={() => setModal('login')}>
                  Sign in
                </button>
              </div>
            ) : isSearch ? (
              <>
                <div className="collection-title">
                  <div>
                    <span className="eyebrow">YOUR PERSONAL RECIPE BOX</span>
                    <h1>
                      {page.query ? `A little inspiration for “${page.query}”` : 'The good stuff.'}
                    </h1>
                  </div>
                  <button className="button secondary" onClick={() => setModal('add')}>
                    <Plus size={18} />
                    Add a recipe
                  </button>
                </div>
                {searchBox}
                <div className="filter-row">
                  <div className="tag-filters">
                    <button
                      className={!page.tag ? 'active' : ''}
                      onClick={() => go(`/search?q=${encodeURIComponent(page.query)}`)}
                    >
                      All recipes
                    </button>
                    {stats.tags.map((t) => (
                      <button
                        className={page.tag === t ? 'active' : ''}
                        key={t}
                        onClick={() =>
                          go(
                            `/search?q=${encodeURIComponent(page.query)}&tag=${encodeURIComponent(t)}`,
                          )
                        }
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <button
                    className="button primary small"
                    disabled={!total || loading}
                    onClick={() => void random(true)}
                  >
                    <Shuffle size={16} />
                    Surprise me
                  </button>
                </div>
                <Notice error={error} />
                <p className="result-count" aria-live="polite">
                  {loading
                    ? 'Looking in your bag…'
                    : `${total} ${total === 1 ? 'recipe' : 'recipes'}${page.query ? ' · Title matches first, then ingredients' : ' worth keeping'}`}
                </p>
                {!loading && (
                  <>
                    <div className="recipe-grid">
                      {recipes.map((r) => (
                        <RecipeCard key={r.id} recipe={r} open={() => go(`/recipes/${r.id}`)} />
                      ))}
                    </div>
                    {!recipes.length && (
                      <div className="empty-state">
                        <BookOpen size={40} />
                        <h2>
                          {page.query || page.tag
                            ? 'Nothing in the bag for that one.'
                            : 'Your first keeper is waiting.'}
                        </h2>
                        <p>
                          {page.query || page.tag
                            ? 'Try another title or ingredient, or clear your filters.'
                            : 'Add a recipe you love. We’ll keep it right here.'}
                        </p>
                        <button
                          className="button secondary"
                          onClick={() => (page.query || page.tag ? go('/search') : setModal('add'))}
                        >
                          {page.query || page.tag ? 'Clear filters' : 'Add your first recipe'}
                        </button>
                      </div>
                    )}
                    {recipes.length < total && (
                      <div className="load-more">
                        <button
                          className="button secondary"
                          onClick={async () => {
                            try {
                              const result = await api<{ recipes: Recipe[] }>(
                                `/recipes?q=${encodeURIComponent(page.query)}&tag=${encodeURIComponent(page.tag)}&offset=${recipes.length}&limit=24`,
                              );
                              setRecipes((r) => [...r, ...result.recipes]);
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          More recipes
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : isDetail ? (
              <>
                <Notice error={error} />
                {loading ? (
                  <p className="empty-note">Opening your recipe…</p>
                ) : (
                  recipe && (
                    <article className="recipe-detail">
                      <div className="detail-top">
                        <span className="eyebrow">FROM YOUR RECIPE COLLECTION</span>
                        <div className="detail-actions">
                          <button className="text-button" onClick={() => setModal('history')}>
                            <HistoryIcon size={16} />
                            History
                          </button>
                          <button
                            className="button secondary small"
                            onClick={() => setModal('edit')}
                          >
                            <Pencil size={15} />
                            Edit recipe
                          </button>
                        </div>
                      </div>
                      <h1>{recipe.title}</h1>
                      <p className="recipe-intro">{recipe.shortDescription}</p>
                      <div className="detail-meta">
                        {recipe.prepMinutes !== null && (
                          <span>
                            <Clock3 size={17} />
                            Prep {recipe.prepMinutes} min
                          </span>
                        )}
                        {recipe.cookMinutes !== null && (
                          <span>
                            <Clock3 size={17} />
                            Cook {recipe.cookMinutes} min
                          </span>
                        )}
                        {recipe.servings !== null && (
                          <span>
                            <Users size={17} />
                            Serves {recipe.servings}
                          </span>
                        )}
                      </div>
                      <div className="detail-tags">
                        {recipe.tags.map((t) => (
                          <button
                            key={t}
                            className="tag"
                            onClick={() => go(`/search?tag=${encodeURIComponent(t)}`)}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      {recipe.longDescription && (
                        <p className="long-description">{recipe.longDescription}</p>
                      )}
                      <div className="cooking-layout">
                        <section className="ingredients-panel">
                          <h2>Ingredients</h2>
                          <p className="hint">Check them off as you go.</p>
                          <ul>
                            {recipe.ingredients.map((i, n) => (
                              <li key={n}>
                                <label className={checked.has(n) ? 'checked' : ''}>
                                  <input
                                    type="checkbox"
                                    checked={checked.has(n)}
                                    onChange={() =>
                                      setChecked((old) => {
                                        const next = new Set(old);
                                        if (next.has(n)) next.delete(n);
                                        else next.add(n);
                                        return next;
                                      })
                                    }
                                  />
                                  <span>
                                    <strong>
                                      {formatQuantity(i.quantity)} {i.unit}
                                    </strong>{' '}
                                    {i.ingredient}
                                    {i.note && <small>{i.note}</small>}
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        </section>
                        <section className="instructions-panel">
                          <h2>Let’s make it</h2>
                          <ol>
                            {recipe.steps.map((s, i) => (
                              <li key={i}>
                                <span className="step-number">
                                  {String(i + 1).padStart(2, '0')}
                                </span>
                                <p>{s.text}</p>
                              </li>
                            ))}
                          </ol>
                        </section>
                      </div>
                      {recipe.notes && (
                        <aside className="recipe-notes">
                          <h3>A few notes</h3>
                          <p>{recipe.notes}</p>
                        </aside>
                      )}
                      <div className="recipe-end">
                        <div className="hint">
                          Saved {new Date(recipe.createdAt).toLocaleDateString()} · Version{' '}
                          {recipe.version}
                          {recipe.sourceUrl && (
                            <p>
                              <a href={recipe.sourceUrl} target="_blank" rel="noreferrer">
                                Original source ↗
                              </a>
                            </p>
                          )}
                        </div>
                        <button
                          className="text-button danger"
                          onClick={async () => {
                            if (
                              !confirm(
                                `Move “${recipe.title}” to recently deleted? You can restore it in your account.`,
                              )
                            )
                              return;
                            try {
                              await post('/changes', {
                                action: 'delete',
                                recipeId: recipe.id,
                                baseVersion: recipe.version,
                              });
                              refresh();
                              go('/search');
                              setToast('Recipe moved to recently deleted.');
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          <Trash2 size={15} />
                          Delete recipe
                        </button>
                      </div>
                    </article>
                  )
                )}
              </>
            ) : (
              <div className="empty-state">
                <h1>This page isn’t in the bag.</h1>
                <button className="button primary" onClick={() => go('/')}>
                  Go home
                </button>
              </div>
            )}
          </>
        )}
      </main>
      {modal === 'login' && (
        <Login
          close={() => setModal(null)}
          done={(u) => {
            setUser(u);
            setModal(null);
            refresh();
          }}
        />
      )}{' '}
      {(modal === 'add' || modal === 'edit') && user && (
        <RecipeEditor
          close={() => setModal(null)}
          saved={saved}
          recipe={modal === 'edit' ? recipe || undefined : undefined}
        />
      )}
      {modal === 'account' && user && (
        <Account
          user={user}
          update={setUser}
          close={() => {
            setModal(null);
            refresh();
          }}
          logout={() => {
            setUser(null);
            setModal(null);
            setRecipes([]);
            setRecipe(null);
            setStats({ recipes: 0, tags: [], pending: 0 });
            go('/');
          }}
        />
      )}
      {modal === 'reviews' && user && <Reviews close={() => setModal(null)} changed={refresh} />}
      {modal === 'history' && recipe && (
        <History recipe={recipe} close={() => setModal(null)} restored={saved} />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
function RecipeCard({ recipe, open }: { recipe: Recipe; open: () => void }) {
  const minutes = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
  return (
    <button className="recipe-card" onClick={open}>
      <div className="card-top">
        <span className="card-icon">
          <BookOpen size={20} strokeWidth={1.4} />
        </span>
        <ArrowRight size={18} />
      </div>
      <h3>{recipe.title}</h3>
      <p>
        {recipe.shortDescription ||
          `${recipe.ingredients.length} ingredients. A recipe worth making.`}
      </p>
      <div className="card-bottom">
        {recipe.tags[0] ? (
          <span className="tag">{recipe.tags[0]}</span>
        ) : (
          <span className="hint">From your kitchen</span>
        )}
        {minutes > 0 && (
          <span>
            <Clock3 size={13} />
            {minutes} min
          </span>
        )}
      </div>
    </button>
  );
}
