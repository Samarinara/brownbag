import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  Check,
  Link2,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Share2,
  Shuffle,
  Sun,
  Tags,
  X,
} from 'lucide-react';
import { api, ApiError, post } from './api';
import {
  Bag,
  ConfirmDialog,
  Modal,
  Notice,
  SkeletonCards,
  SkeletonDetail,
  Toast,
  type ToastData,
} from './components';
import { type RecipeInput, type RecipeView, type SessionUser } from '../shared/atproto';
import { NetworkEditorPage } from './NetworkEditor';
import { NetworkAccount } from './NetworkAccount';
import './network.css';
import {
  CardFacts,
  RecipeFacts,
  RecipeImage,
  RecipeStory,
  RecipeTags,
  ingredientSections,
} from './RecipePresentation';

type Feed = 'discover' | 'following' | 'cookbook';
type ThemePreference = 'system' | 'light' | 'dark';
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

const themeOptions: { value: ThemePreference; label: string; icon: typeof Monitor }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

function savedTheme(): ThemePreference {
  const value = localStorage.getItem('brownbag-theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}

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
  const [toast, setToast] = useState<ToastData | null>(null);
  const [login, setLogin] = useState(false);
  const [account, setAccount] = useState(false);
  const [accountMenu, setAccountMenu] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(savedTheme);
  const [editorRoute, setEditorRoute] = useState(currentEditorRoute);
  const leaveGuard = useRef<() => boolean>(() => true);
  const activeUrl = useRef(location.pathname + location.search);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string>();
  const [confirmDeleteRecipe, setConfirmDeleteRecipe] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const pageRequest = useRef(0);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
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
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('brownbag-theme', theme);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateThemeColor = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.resolvedTheme = dark ? 'dark' : 'light';
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#20241f' : '#f7f5ee');
    };
    updateThemeColor();
    if (theme === 'system') media.addEventListener('change', updateThemeColor);
    return () => media.removeEventListener('change', updateThemeColor);
  }, [theme]);
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
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = (text: string, kind: ToastData['kind'] = 'success') => setToast({ kind, text });
  const action = async (work: () => Promise<unknown>, success: string) => {
    if (!user) {
      setLogin(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await work();
      notify(success, 'success');
      refresh();
    } catch (e) {
      const text = message(e);
      setError(text);
      setToast({ kind: 'error', text });
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
  const browseAnnouncement = loading
    ? 'Loading recipes.'
    : uri
      ? recipe
        ? `Opened ${recipe.record.title}.`
        : 'Recipe loading complete.'
      : `Showing ${recipes.length} recipe${recipes.length === 1 ? '' : 's'}${search ? ` for ${search}` : ''}${tag ? ` tagged ${tag}` : ''}.`;
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
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="network-header" aria-label="Site header">
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
            <div className="account-menu-wrap">
              <button
                ref={accountButtonRef}
                className="network-account-button"
                onClick={() => setAccountMenu((open) => !open)}
                aria-label="Open account menu"
                aria-haspopup="menu"
                aria-expanded={accountMenu}
                title={user.handle ? `@${user.handle}` : 'Account'}
              >
                {(user.handle?.replace(/^@/, '')[0] || 'A').toUpperCase()}
              </button>
              {accountMenu && (
                <AccountMenu
                  user={user}
                  theme={theme}
                  setTheme={setTheme}
                  close={(restoreFocus = true) => {
                    setAccountMenu(false);
                    if (restoreFocus)
                      requestAnimationFrame(() => accountButtonRef.current?.focus());
                  }}
                  manage={() => {
                    setAccountMenu(false);
                    setAccount(true);
                  }}
                  signOut={async () => {
                    if (!leaveGuard.current())
                      throw new Error('Finish or save your recipe before signing out.');
                    await post('/auth/logout', {});
                    leaveGuard.current = () => true;
                    setUser(null);
                    setAccountMenu(false);
                    setFeed('discover');
                    go(null, 'discover');
                    notify('Signed out');
                  }}
                />
              )}
            </div>
          ) : (
            <button
              className="network-sign-in"
              disabled={!ready || configured !== true}
              title={
                !ready
                  ? 'Sign in is unavailable while the app loads.'
                  : configured !== true
                    ? 'Sign in is unavailable until setup is complete.'
                    : 'Sign in to your cookbook'
              }
              onClick={() => setLogin(true)}
            >
              Sign in
            </button>
          )}
        </div>
      </header>
      <main id="main-content" className="network-main" tabIndex={-1} aria-label="Recipe content">
        <p className="sr-only" role="status" aria-atomic="true">
          {browseAnnouncement}
        </p>
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
            <>
              <p className="sr-only" role="status">
                Opening your cookbook…
              </p>
              <section className="network-editor-page" aria-hidden="true">
                <div className="skeleton skeleton-line short" />
                <div className="skeleton skeleton-line hero" />
                <div className="skeleton skeleton-line" />
              </section>
            </>
          ) : user ? (
            <NetworkEditorPage
              key={editorRoute}
              route={editorRoute}
              userDid={user.did}
              leaveGuard={leaveGuard}
              close={() => go(uri)}
              done={(result) => {
                notify(result ? 'Recipe published' : 'Private draft saved');
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
              <>
                <p className="sr-only" role="status">
                  Opening the cookbook…
                </p>
                <div aria-hidden="true">
                  <SkeletonDetail />
                </div>
              </>
            ) : (
              recipe && (
                <article className="network-detail" lang={recipe.record.language}>
                  <p className="eyebrow">
                    FROM THE KITCHEN OF{' '}
                    {recipe.authorHandle ? `@${recipe.authorHandle}` : 'A COMMUNITY COOK'}
                  </p>
                  <h1>{recipe.record.title}</h1>
                  <p className="network-summary">{recipe.record.summary}</p>
                  <RecipeFacts record={recipe.record} />
                  <div
                    className="network-actions network-detail-actions"
                    role="group"
                    aria-label="Recipe actions"
                  >
                    <span
                      className="disabled-hint"
                      title={
                        busy
                          ? 'Please wait while we finish the current action.'
                          : user && !entry
                            ? 'Checking whether this recipe is in your cookbook…'
                            : entry?.saved
                              ? 'Remove this recipe from your cookbook'
                              : user
                                ? 'Save this recipe to your cookbook'
                                : 'Sign in to save this recipe to your cookbook'
                      }
                    >
                      <button
                        className="button primary"
                        disabled={busy || (!!user && !entry)}
                        aria-label={entry?.saved ? 'Remove from cookbook' : 'Save to cookbook'}
                        aria-describedby="save-hint"
                        onClick={() => {
                          if (!user) {
                            setLogin(true);
                            return;
                          }
                          if (entry?.saved) {
                            const savedTags = entry.tags;
                            const target = recipe.uri;
                            void (async () => {
                              if (!user) return;
                              setBusy(true);
                              setError('');
                              try {
                                await api('/bookmarks', {
                                  method: 'DELETE',
                                  body: JSON.stringify({ uri: target }),
                                });
                                setToast({
                                  kind: 'success',
                                  text: 'Removed from your cookbook',
                                  actionLabel: 'Undo',
                                  onAction: () => {
                                    void (async () => {
                                      try {
                                        await post('/bookmarks', {
                                          uri: target,
                                          tags: savedTags,
                                        });
                                        notify('Restored to your cookbook');
                                        refresh();
                                      } catch (e) {
                                        setError(message(e));
                                        setToast({ kind: 'error', text: message(e) });
                                      }
                                    })();
                                    setToast(null);
                                  },
                                });
                                refresh();
                              } catch (e) {
                                const text = message(e);
                                setError(text);
                                setToast({ kind: 'error', text });
                              } finally {
                                setBusy(false);
                              }
                            })();
                          } else setTagSelector(true);
                        }}
                      >
                        {entry?.saved ? <Check size={15} /> : <Bookmark size={15} />}
                        {entry?.saved ? 'Saved' : 'Save'}
                      </button>
                    </span>
                    <span id="save-hint" className="sr-only">
                      {busy
                        ? 'Save is unavailable while another action is in progress.'
                        : user && !entry
                          ? 'Save is unavailable until we finish checking your cookbook.'
                          : !user
                            ? 'Choosing Save will ask you to sign in first.'
                            : ''}
                    </span>
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
                      title="Create your own copy of this recipe"
                    >
                      Make it your own
                    </button>
                    <div className="detail-share-row" role="group" aria-label="Share this recipe">
                      <button
                        type="button"
                        className="icon-button"
                        title="Copy link to this recipe"
                        aria-label="Copy link to this recipe"
                        onClick={() => {
                          const url = `${location.origin}${recipeUrl(recipe.uri)}`;
                          const done = () => notify('Link copied to clipboard');
                          if (navigator.clipboard?.writeText) {
                            void navigator.clipboard
                              .writeText(url)
                              .then(done)
                              .catch(() => {
                                setToast({ kind: 'error', text: 'Could not copy the link.' });
                              });
                          } else {
                            window.prompt('Copy this link:', url);
                          }
                        }}
                      >
                        <Link2 size={17} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        title="Share this recipe"
                        aria-label="Share this recipe"
                        onClick={() => {
                          const url = `${location.origin}${recipeUrl(recipe.uri)}`;
                          if (navigator.share) {
                            void navigator
                              .share({ title: recipe.record.title, url })
                              .catch(() => {});
                          } else if (navigator.clipboard?.writeText) {
                            void navigator.clipboard
                              .writeText(url)
                              .then(() => notify('Link copied to clipboard'))
                              .catch(() => {
                                setToast({ kind: 'error', text: 'Could not share the link.' });
                              });
                          } else {
                            window.prompt('Copy this link:', url);
                          }
                        }}
                      >
                        <Share2 size={17} />
                      </button>
                    </div>
                    <FloatingDetails className="recipe-more-actions" summary="More options">
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
                              className="button secondary danger"
                              disabled={busy}
                              title="Permanently delete this published recipe"
                              onClick={() => setConfirmDeleteRecipe(true)}
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
                    </FloatingDetails>
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
                  <RecipeStory key={recipe.uri} description={recipe.record.description} />
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
                      {ingredientSections(recipe.record.ingredients).map(
                        (section, sectionIndex) => (
                          <div className="network-ingredient-section" key={sectionIndex}>
                            {(section.name || sectionIndex > 0) && (
                              <h3>{section.name || 'Other ingredients'}</h3>
                            )}
                            <ul className="network-ingredients">
                              {section.items.map(({ ingredient, index }) => (
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
                                      {[ingredient.quantity, ingredient.unit, ingredient.name]
                                        .filter(Boolean)
                                        .join(' ')}
                                      {ingredient.preparation && `, ${ingredient.preparation}`}
                                    </span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ),
                      )}
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
                  role="search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSearch(query);
                  }}
                >
                  <Search size={22} strokeWidth={1.7} aria-hidden="true" />
                  <input
                    aria-label="Search recipes"
                    placeholder="Find a recipe, or start with an ingredient…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      type="button"
                      className="search-clear"
                      aria-label="Clear search"
                      title="Clear search"
                      onClick={() => {
                        setQuery('');
                        setSearch('');
                      }}
                    >
                      <X size={16} />
                    </button>
                  )}
                  <button
                    className="network-search-submit"
                    aria-label="Search"
                    title="Search"
                    type="submit"
                  >
                    ↵
                  </button>
                </form>
                <div className="network-hero-actions">
                  {feed !== 'cookbook' && (
                    <span
                      className="disabled-hint"
                      title={
                        loading
                          ? 'Surprise Me is unavailable while recipes are loading.'
                          : recipes.length === 0
                            ? 'Surprise Me needs at least one recipe to pick from.'
                            : 'Open a random recipe'
                      }
                    >
                      <button
                        className="button primary"
                        disabled={loading || recipes.length === 0}
                        aria-describedby="surprise-hint"
                        onClick={() => {
                          const item = recipes[Math.floor(Math.random() * recipes.length)];
                          if (item) go(item.uri);
                        }}
                      >
                        <Shuffle size={18} />
                        Surprise me
                      </button>
                    </span>
                  )}
                  <span
                    className="disabled-hint"
                    title={
                      configured !== true
                        ? 'Adding recipes is unavailable until setup is complete.'
                        : 'Add a new recipe'
                    }
                  >
                    <button
                      className="button secondary"
                      disabled={configured !== true}
                      onClick={() => edit({ data: blank() })}
                    >
                      <Plus size={18} />
                      Add a recipe
                    </button>
                  </span>
                </div>
                <span id="surprise-hint" className="sr-only">
                  {loading
                    ? 'Surprise Me is disabled while recipes are loading.'
                    : recipes.length === 0
                      ? 'Surprise Me is disabled because there are no recipes to choose from.'
                      : ''}
                </span>
              </div>
            </section>
            {feed === 'cookbook' && (
              <nav className="network-tag-chits" aria-label="Filter cookbook by tag">
                {['', ...tags].map((value) => (
                  <button
                    key={value}
                    className={tag === value ? 'active' : ''}
                    aria-pressed={tag === value}
                    title={value ? `Show recipes tagged ${value}` : 'Show all recipes'}
                    aria-label={`${tag === value ? 'Selected: ' : 'Filter by '}${value || 'all recipes'}`}
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
              <>
                <p className="sr-only" role="status">
                  Gathering recipes…
                </p>
                <p className="skeleton-grid-label" aria-hidden="true">
                  Gathering recipes…
                </p>
                <div aria-hidden="true">
                  <SkeletonCards count={6} />
                </div>
              </>
            ) : (
              <>
                {!loading && !error && (
                  <div className="result-count-row" role="status" aria-live="polite">
                    <span>
                      {recipes.length === 1 ? '1 recipe' : `${recipes.length} recipes`}
                      {search ? ` for “${search}”` : ''}
                      {feed === 'cookbook' && tag ? ` tagged “${tag}”` : ''}
                      {feed === 'following' && !search ? ' from cooks you follow' : ''}
                      {nextCursor ? ' so far' : ''}
                    </span>
                    {(search || tag) && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setQuery('');
                          setSearch('');
                          setTag('');
                        }}
                      >
                        Clear search & filters
                      </button>
                    )}
                  </div>
                )}
                {feed === 'cookbook' && !search && !tag && drafts.length > 0 && (
                  <section className="network-drafts" aria-label="Private drafts">
                    <h2>Private drafts</h2>
                    <p>Only you can see these. Publish when you’re ready to share.</p>
                    {drafts.map((draft) => (
                      <div key={draft.id}>
                        <button
                          className="button secondary"
                          title={`Continue editing ${draft.data.title || 'untitled recipe'}`}
                          onClick={() => edit({ data: draft.data, draftId: draft.id })}
                        >
                          {draft.data.title || 'Untitled recipe'}
                        </button>
                        <button
                          className="icon-button danger"
                          disabled={busy}
                          aria-label={`Delete draft ${draft.data.title || 'untitled recipe'}`}
                          title={`Delete draft ${draft.data.title || 'untitled recipe'}`}
                          onClick={() => setPendingDraft(draft)}
                        >
                          <X size={16} />
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
                          <RecipeImage recipe={item} />
                          <div className="network-card-body">
                            <p className="network-card-author">
                              By {item.authorHandle ? `@${item.authorHandle}` : 'a community cook'}
                            </p>
                            <h2>{item.record.title}</h2>
                            {item.record.summary && (
                              <p className="network-card-summary">{item.record.summary}</p>
                            )}
                            <CardFacts record={item.record} />
                            <RecipeTags
                              tags={feed === 'cookbook' ? item.cookbookTags : item.record.tags}
                              limit={3}
                            />
                            <div className="network-card-meta">
                              <span>View recipe</span>
                              <span>
                                {feed === 'cookbook' && item.cookbookAddedAt
                                  ? new Date(item.cookbookAddedAt).toLocaleDateString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric',
                                    })
                                  : '→'}
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
                          ? 'Try another tag, ingredient or title — or clear the search to browse everything.'
                          : feed === 'following'
                            ? 'Follow a cook from their recipe to see what they share here.'
                            : 'Share a recipe you love, or start with a private draft.'}
                      </p>
                      <div className="empty-actions">
                        {search || tag ? (
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => {
                              setQuery('');
                              setSearch('');
                              setTag('');
                            }}
                          >
                            Clear search & filters
                          </button>
                        ) : null}
                        {feed === 'following' && !search ? (
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => selectFeed('discover')}
                          >
                            Discover recipes
                          </button>
                        ) : null}
                        {feed !== 'following' && !search && !tag ? (
                          <button
                            type="button"
                            className="button primary"
                            disabled={configured !== true}
                            title={
                              configured !== true
                                ? 'Adding recipes is unavailable until setup is complete.'
                                : 'Add your first recipe'
                            }
                            onClick={() => edit({ data: blank() })}
                          >
                            <Plus size={16} />
                            Add a recipe
                          </button>
                        ) : null}
                      </div>
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
                        const text = message(e);
                        setError(text);
                        setToast({ kind: 'error', text });
                      } finally {
                        setBusy(false);
                      }
                    }}
                    title={busy ? 'Please wait while recipes load.' : 'Load more recipes'}
                  >
                    {busy ? 'Loading…' : 'More recipes'}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </main>
      {toast && <Toast toast={toast} dismiss={() => setToast(null)} />}
      {confirmDeleteRecipe && recipe && (
        <ConfirmDialog
          title="Delete this recipe?"
          confirmLabel="Delete recipe"
          danger
          busy={confirmBusy}
          close={() => {
            if (!confirmBusy) setConfirmDeleteRecipe(false);
          }}
          confirm={() => {
            setConfirmBusy(true);
            void (async () => {
              try {
                await api('/recipe', {
                  method: 'DELETE',
                  body: JSON.stringify({ uri: recipe.uri, cid: recipe.cid }),
                });
                setConfirmDeleteRecipe(false);
                notify('Recipe deleted');
                go(null);
                refresh();
              } catch (e) {
                const text = message(e);
                setError(text);
                setToast({ kind: 'error', text });
              } finally {
                setConfirmBusy(false);
              }
            })();
          }}
        >
          <p>
            <strong>{recipe.record.title}</strong> will be permanently removed from your public
            account.
          </p>
          <p className="confirm-warning">
            This cannot be undone. Copies already saved to other people’s cookbooks may remain.
          </p>
        </ConfirmDialog>
      )}
      {pendingDraft && (
        <ConfirmDialog
          title="Delete this draft?"
          confirmLabel="Delete draft"
          danger
          busy={confirmBusy}
          close={() => {
            if (!confirmBusy) setPendingDraft(null);
          }}
          confirm={() => {
            const target = pendingDraft;
            setConfirmBusy(true);
            void (async () => {
              try {
                await api(`/drafts/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
                setPendingDraft(null);
                setToast({
                  kind: 'success',
                  text: 'Draft deleted',
                  actionLabel: 'Undo',
                  onAction: () => {
                    void (async () => {
                      try {
                        await post('/drafts', { data: target.data });
                        notify('Draft restored');
                        refresh();
                      } catch (e) {
                        setError(message(e));
                        setToast({ kind: 'error', text: message(e) });
                      }
                    })();
                    setToast(null);
                  },
                });
                refresh();
              } catch (e) {
                const text = message(e);
                setError(text);
                setToast({ kind: 'error', text });
              } finally {
                setConfirmBusy(false);
              }
            })();
          }}
        >
          <p>
            <strong>{pendingDraft.data.title || 'Untitled recipe'}</strong> will be permanently
            removed. Only you can see this draft.
          </p>
          <p className="confirm-warning">
            This cannot be undone, but you can restore it right away with Undo.
          </p>
        </ConfirmDialog>
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
            notify(entry?.saved ? 'Tags updated' : 'Saved to your cookbook');
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
            notify('Signed out');
          }}
          close={() => {
            setAccount(false);
            refresh();
            requestAnimationFrame(() => accountButtonRef.current?.focus());
          }}
        />
      )}
    </div>
  );
}

function FloatingDetails({
  className,
  summary,
  children,
}: {
  className: string;
  summary: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target))
        ref.current.open = false;
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open) {
        event.preventDefault();
        ref.current.open = false;
        ref.current.querySelector<HTMLElement>('summary')?.focus();
      }
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, []);
  return (
    <details className={className} ref={ref}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

function AccountMenu({
  user,
  theme,
  setTheme,
  close,
  manage,
  signOut,
}: {
  user: SessionUser;
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  close: (restoreFocus?: boolean) => void;
  manage: () => void;
  signOut: () => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !ref.current?.contains(target) &&
        !target.closest('.network-account-button')
      )
        close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [close]);
  const moveMenuFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('button:not([disabled])') || [],
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (!items.length) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div
      className="account-menu"
      role="menu"
      ref={ref}
      onKeyDown={moveMenuFocus}
      aria-label="Account menu"
    >
      <div className="account-menu-profile">
        <span className="account-menu-avatar">
          {(user.handle?.replace(/^@/, '')[0] || 'A').toUpperCase()}
        </span>
        <div>
          <strong>{user.handle ? `@${user.handle.replace(/^@/, '')}` : 'Your account'}</strong>
          <span>Your brownbag</span>
        </div>
      </div>
      <div className="theme-picker" role="radiogroup" aria-label="Appearance">
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            className={theme === value ? 'active' : ''}
            onClick={() => setTheme(value)}
            title={`${label} theme`}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="account-menu-actions">
        <button role="menuitem" onClick={manage}>
          <Settings size={16} />
          <span>Manage account</span>
        </button>
        <button
          role="menuitem"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void signOut().catch((e) => {
              setError(message(e));
              setBusy(false);
            });
          }}
        >
          <LogOut size={16} />
          <span>{busy ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
      {error && (
        <p className="account-menu-error" role="alert">
          {error}
        </p>
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
