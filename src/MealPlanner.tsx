import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Menu, Plus } from 'lucide-react';
import { api, post } from './api';
import { Modal, Notice } from './components';
import { RecipeImage, recipeTime } from './RecipePresentation';
import type { RecipeView } from '../shared/atproto';
import {
  addDays,
  calendarDateSchema,
  dateObject,
  localDate,
  mealLabels,
  mealSlots,
  plannerUrl,
  retentionStart,
  weekStart,
  type MealEntry,
  type MealSlot,
  type MealTarget,
  type PlannerSettings,
} from '../shared/planner';

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Please try again.';
export const displayDate = (
  date: string,
  options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' },
) => dateObject(date).toLocaleDateString(undefined, options);
export const defaultPlannerUrl = () =>
  plannerUrl(localDate(), window.matchMedia('(max-width: 700px)').matches);
function SlotSelect({ value, change }: { value: MealSlot; change: (slot: MealSlot) => void }) {
  return (
    <label>
      Meal
      <select value={value} onChange={(event) => change(event.target.value as MealSlot)}>
        {mealSlots.map((slot) => (
          <option key={slot} value={slot}>
            {mealLabels[slot]}
          </option>
        ))}
      </select>
    </label>
  );
}
export function PlannerPreferences() {
  const [settings, setSettings] = useState<PlannerSettings>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    api<PlannerSettings>('/planner/settings')
      .then((value) => {
        if (alive) setSettings(value);
      })
      .catch((error) => {
        if (alive) setError(errorMessage(error));
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <section>
      <h3>Meal Planner</h3>
      <p>
        Choose the meal selected when you add a recipe. Your preference follows you across devices.
      </p>
      <Notice error={error} />
      {settings && (
        <fieldset disabled={busy} className="planner-preference">
          <SlotSelect
            value={settings.defaultSlot}
            change={(defaultSlot) => {
              setBusy(true);
              setError('');
              setSaved(false);
              api<PlannerSettings>('/planner/settings', {
                method: 'PUT',
                body: JSON.stringify({ defaultSlot }),
              })
                .then((value) => {
                  setSettings(value);
                  setSaved(true);
                })
                .catch((error) => setError(errorMessage(error)))
                .finally(() => setBusy(false));
            }}
          />
        </fieldset>
      )}
      {saved && <p role="status">Default meal saved.</p>}
      <p className="hint">
        Plans older than one calendar month are permanently deleted. Future plans are kept. The
        retention boundary uses UTC.
      </p>
    </section>
  );
}

export function PlanRecipeDialog({
  recipe,
  close,
  done,
}: {
  recipe: RecipeView;
  close: () => void;
  done: (target: MealTarget) => void;
}) {
  const [date, setDate] = useState(localDate);
  const [slot, setSlot] = useState<MealSlot>('dinner');
  const [note, setNote] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = useRef(crypto.randomUUID());
  useEffect(() => {
    let alive = true;
    api<PlannerSettings>('/planner/settings')
      .then((settings) => {
        if (alive) {
          setSlot(settings.defaultSlot);
          setReady(true);
        }
      })
      .catch((error) => {
        if (alive) {
          setError(errorMessage(error));
          setReady(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Modal
      title="Add to Meal Planner"
      close={() => {
        if (!busy) close();
      }}
    >
      <p className="muted">{recipe.record.title}</p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          post('/planner', { id: id.current, uri: recipe.uri, date, slot, note })
            .then(() => done({ date, slot }))
            .catch((error) => setError(errorMessage(error)))
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={busy || !ready} className="planner-form-fields">
          <label>
            Date
            <input
              type="date"
              min={retentionStart()}
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <SlotSelect value={slot} change={setSlot} />
          <details>
            <summary>Add a note</summary>
            <label>
              Recipe note
              <textarea
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </details>
        </fieldset>
        <Notice error={error} />
        <button className="button primary" disabled={busy || !ready}>
          {busy ? 'Adding…' : 'Add recipe'}
        </button>
      </form>
    </Modal>
  );
}

function RecipePicker({
  target,
  close,
  added,
  create,
}: {
  target: MealTarget;
  close: () => void;
  added: () => void;
  create: () => void;
}) {
  const [feed, setFeed] = useState<'cookbook' | 'discover'>('cookbook');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [recipes, setRecipes] = useState<RecipeView[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef(0);
  const pending = useRef<{ uri: string; id: string } | undefined>(undefined);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 220);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const current = ++request.current;
    setLoading(true);
    setError('');
    setRecipes([]);
    setCursor(undefined);
    api<{ recipes: RecipeView[]; nextCursor?: string }>(
      `/recipes?${new URLSearchParams({ feed, q: search, limit: '24' })}`,
    )
      .then((result) => {
        if (current === request.current) {
          setRecipes(result.recipes);
          setCursor(result.nextCursor);
        }
      })
      .catch((error) => {
        if (current === request.current) setError(errorMessage(error));
      })
      .finally(() => {
        if (current === request.current) setLoading(false);
      });
    return () => {
      request.current++;
    };
  }, [feed, search]);
  async function add(recipe: RecipeView) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    if (pending.current?.uri !== recipe.uri)
      pending.current = { uri: recipe.uri, id: crypto.randomUUID() };
    try {
      await post('/planner', { ...target, uri: recipe.uri, id: pending.current.id });
      pending.current = undefined;
      added();
      setNotice(
        `Added ${recipe.record.title} to ${mealLabels[target.slot]}. Add another or choose Done.`,
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Choose recipes"
      wide
      close={() => {
        if (!busy) close();
      }}
    >
      <p className="muted">
        {displayDate(target.date)} · {mealLabels[target.slot]}
      </p>
      <div className="planner-picker-toolbar">
        <div className="planner-toggle" role="group" aria-label="Recipe collection">
          {(['cookbook', 'discover'] as const).map((value) => (
            <button
              key={value}
              disabled={busy}
              aria-pressed={feed === value}
              onClick={() => setFeed(value)}
            >
              {value === 'cookbook' ? 'Cookbook' : 'Discover'}
            </button>
          ))}
        </div>
        <button className="button secondary" disabled={busy} onClick={create}>
          <Plus size={16} /> Create new recipe
        </button>
      </div>
      <label className="planner-search">
        Search recipes
        <input
          type="search"
          placeholder="Search by title or ingredient…"
          value={query}
          disabled={busy}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <Notice error={error} />
      <p role="status" className="planner-picker-notice">
        {notice || (loading ? 'Loading recipes…' : '')}
      </p>
      <div className="planner-picker-results" aria-busy={loading}>
        {!loading && !recipes.length && (
          <p className="muted">
            No recipes found. Try Discover, another search, or create a recipe.
          </p>
        )}
        {recipes.map((recipe) => {
          const time = recipeTime(recipe.record);
          return (
            <div className="planner-picker-recipe" key={recipe.uri}>
              <div>
                <strong>{recipe.record.title}</strong>
                <small>
                  {recipe.authorHandle ? `@${recipe.authorHandle}` : 'Community cook'}
                  {time ? ` · ${time.minutes} min` : ''}
                </small>
              </div>
              <button
                className="button secondary"
                disabled={busy || loading}
                aria-label={`Add ${recipe.record.title}`}
                onClick={() => void add(recipe)}
              >
                <Plus size={16} /> Add
              </button>
            </div>
          );
        })}
        {cursor && (
          <button
            className="button secondary"
            disabled={busy || loading}
            onClick={async () => {
              const current = request.current;
              setBusy(true);
              try {
                const result = await api<{ recipes: RecipeView[]; nextCursor?: string }>(
                  `/recipes?${new URLSearchParams({ feed, q: search, limit: '24', cursor })}`,
                );
                if (current === request.current) {
                  setRecipes((items) => [
                    ...items,
                    ...result.recipes.filter(
                      (recipe) => !items.some((item) => item.uri === recipe.uri),
                    ),
                  ]);
                  setCursor(result.nextCursor);
                }
              } catch (error) {
                setError(errorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Load more
          </button>
        )}
      </div>
      <div className="modal-footer">
        <button className="button primary" disabled={busy} onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function EntryEditor({
  entry,
  mode,
  close,
  changed,
}: {
  entry: MealEntry;
  mode: 'move' | 'note';
  close: () => void;
  changed: () => void;
}) {
  const [date, setDate] = useState(entry.date);
  const [slot, setSlot] = useState(entry.slot);
  const [note, setNote] = useState(entry.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title={mode === 'move' ? 'Move planned recipe' : 'Recipe note'}
      close={() => {
        if (!busy) close();
      }}
    >
      <p>{entry.recipe.record.title}</p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          api(`/planner/${entry.id}`, {
            method: 'PATCH',
            body: JSON.stringify(mode === 'move' ? { date, slot } : { note }),
          })
            .then(changed)
            .catch((error) => setError(errorMessage(error)))
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={busy} className="planner-form-fields">
          {mode === 'move' ? (
            <>
              <label>
                Date
                <input
                  type="date"
                  min={retentionStart()}
                  required
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <SlotSelect value={slot} change={setSlot} />
            </>
          ) : (
            <label>
              Note
              <textarea
                autoFocus
                value={note}
                maxLength={2000}
                rows={4}
                onChange={(event) => setNote(event.target.value)}
              />
              <small>Also shown with the other notes for this meal.</small>
            </label>
          )}
        </fieldset>
        <Notice error={error} />
        <button className="button primary" disabled={busy}>
          {busy ? 'Saving…' : mode === 'move' ? 'Move recipe' : 'Save note'}
        </button>
      </form>
    </Modal>
  );
}

function MonthPicker({
  selected,
  close,
  choose,
}: {
  selected: string;
  close: () => void;
  choose: (date: string) => void;
}) {
  const [month, setMonth] = useState(selected.slice(0, 7) + '-01');
  const [planned, setPlanned] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const first = weekStart(month);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setPlanned(new Set());
    api<{ entries: MealEntry[] }>(`/planner?from=${first}&to=${addDays(first, 41)}`)
      .then(({ entries }) => {
        if (alive) setPlanned(new Set(entries.map((entry) => entry.date)));
      })
      .catch((error) => {
        if (alive) setError(errorMessage(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [first]);
  const shift = (amount: number) => {
    const date = dateObject(month);
    date.setMonth(date.getMonth() + amount);
    setMonth(localDate(date));
  };
  return (
    <Modal title="Choose a week" close={close}>
      <div className="planner-month-heading">
        <button className="icon-button" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft />
        </button>
        <strong>{displayDate(month, { month: 'long', year: 'numeric' })}</strong>
        <button className="icon-button" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight />
        </button>
      </div>
      <Notice error={error} />
      <div className="planner-month-grid" aria-busy={loading}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
          <span key={day}>{day}</span>
        ))}
        {Array.from({ length: 42 }, (_, index) => {
          const date = addDays(first, index);
          return (
            <button
              key={date}
              className={`${date.slice(0, 7) !== month.slice(0, 7) ? 'outside' : ''} ${planned.has(date) ? 'planned' : ''} ${weekStart(date) === weekStart(selected) ? 'selected-week' : ''}`}
              aria-label={`${displayDate(date, { dateStyle: 'full' })}${planned.has(date) ? ', meals planned' : ''}`}
              aria-current={date === localDate() ? 'date' : undefined}
              onClick={() => choose(date)}
            >
              {dateObject(date).getDate()}
            </button>
          );
        })}
      </div>
      <p className="hint" role="status">
        {loading
          ? 'Checking planned meals…'
          : 'Bold dates have meals planned. Select a date to open its week.'}
      </p>
    </Modal>
  );
}

export function MealPlanner({
  route,
  navigate,
  openRecipe,
  createRecipe,
}: {
  route: string;
  navigate: (url: string) => void;
  openRecipe: (uri: string) => void;
  createRecipe: (target: MealTarget) => void;
}) {
  const url = new URL(route, location.origin);
  const parsed = calendarDateSchema.safeParse(url.searchParams.get('date'));
  const date = parsed.success ? parsed.data : localDate();
  const day = url.pathname === '/meal-planner/day';
  const start = weekStart(date);
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [picker, setPicker] = useState<MealTarget>();
  const [month, setMonth] = useState(false);
  const [editing, setEditing] = useState<{ entry: MealEntry; mode: 'move' | 'note' }>();
  const [menu, setMenu] = useState<string>();
  const [busy, setBusy] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    const update = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setMenu(undefined);
    api<{ entries: MealEntry[] }>(`/planner?from=${start}&to=${addDays(start, 6)}`)
      .then(({ entries }) => {
        if (alive) setEntries(entries);
      })
      .catch((error) => {
        if (alive) setError(errorMessage(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [start, revision]);
  useEffect(() => {
    if (!day && board.current) {
      const column = board.current.querySelector<HTMLElement>(`[data-date="${date}"]`);
      if (column) board.current.scrollLeft = column.offsetLeft - board.current.offsetLeft;
    }
  }, [day, date]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.planner-entry-menu'))
        setMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        document.getElementById(`meal-menu-${menu}`)?.focus();
        setMenu(undefined);
      }
    };
    document.addEventListener('click', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);
  const days = day ? [date] : Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return (
    <section className={`meal-planner ${day ? 'is-day' : 'is-week'}`}>
      <div className="planner-heading">
        <div>
          <p className="eyebrow">A LITTLE PLANNING, GOOD FOOD ALL WEEK</p>
          <h1>Meal Planner</h1>
        </div>
        <div className="planner-toggle" role="group" aria-label="Planner view">
          <button aria-pressed={!day} onClick={() => navigate(plannerUrl(date))}>
            Week
          </button>
          <button aria-pressed={day} onClick={() => navigate(plannerUrl(date, true))}>
            Day
          </button>
        </div>
      </div>
      <div className="planner-toolbar">
        <div className="planner-date-nav">
          <button
            className="icon-button"
            aria-label={day ? 'Previous day' : 'Previous week'}
            onClick={() => navigate(plannerUrl(addDays(date, day ? -1 : -7), day))}
          >
            <ChevronLeft />
          </button>
          <button
            className="planner-date-title"
            aria-haspopup="dialog"
            onClick={() => setMonth(true)}
          >
            <CalendarDays size={18} />
            {day
              ? displayDate(date, { month: 'short', day: 'numeric', year: 'numeric' })
              : `${displayDate(start, { month: 'short', day: 'numeric' })} – ${displayDate(addDays(start, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`}
          </button>
          <button
            className="icon-button"
            aria-label={day ? 'Next day' : 'Next week'}
            onClick={() => navigate(plannerUrl(addDays(date, day ? 1 : 7), day))}
          >
            <ChevronRight />
          </button>
        </div>
        <button className="button secondary" onClick={() => navigate(plannerUrl(localDate(), day))}>
          Today
        </button>
      </div>
      <Notice error={error} />
      {error && (
        <button className="text-button" onClick={refresh}>
          Try again
        </button>
      )}
      <p className="planner-status" role="status">
        {loading ? 'Loading your meals…' : notice}
      </p>
      <div className="planner-board" ref={board} aria-busy={loading}>
        {days.map((currentDate) => (
          <section
            className={`planner-day ${currentDate === localDate() ? 'is-today' : ''}`}
            data-date={currentDate}
            key={currentDate}
            aria-label={displayDate(currentDate)}
          >
            <button
              className="planner-day-heading"
              onClick={() => navigate(plannerUrl(currentDate, true))}
              aria-label={`Open ${displayDate(currentDate)} day view`}
            >
              <span>{displayDate(currentDate, { weekday: 'long' })}</span>
              <strong>{displayDate(currentDate, { month: 'short', day: 'numeric' })}</strong>
              {currentDate === localDate() && <small>Today</small>}
            </button>
            {mealSlots.map((slot) => {
              const meals = entries.filter(
                (entry) => entry.date === currentDate && entry.slot === slot,
              );
              const notes = meals.filter((entry) => entry.note);
              return (
                <section
                  className="planner-slot"
                  key={slot}
                  aria-label={`${mealLabels[slot]} on ${displayDate(currentDate)}`}
                >
                  <div className="planner-slot-heading">
                    <h2>{mealLabels[slot]}</h2>
                    <button
                      className="icon-button"
                      disabled={loading || currentDate < retentionStart()}
                      aria-label={`Add recipe to ${mealLabels[slot]} on ${displayDate(currentDate)}`}
                      onClick={() => setPicker({ date: currentDate, slot })}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  {!loading && !meals.length && (
                    <button
                      className="planner-empty-slot"
                      disabled={currentDate < retentionStart()}
                      onClick={() => setPicker({ date: currentDate, slot })}
                    >
                      {currentDate < retentionStart() ? (
                        'History expired'
                      ) : (
                        <>
                          <Plus size={16} /> Add recipe
                        </>
                      )}
                    </button>
                  )}
                  {!loading &&
                    meals.map((entry) => {
                      const time = recipeTime(entry.recipe.record);
                      return (
                        <article className="planner-entry" key={entry.id}>
                          <a
                            href={`/recipe?uri=${encodeURIComponent(entry.recipe.uri)}`}
                            onClick={(event) => {
                              event.preventDefault();
                              openRecipe(entry.recipe.uri);
                            }}
                          >
                            {day && entry.recipe.record.images?.length ? (
                              <RecipeImage recipe={entry.recipe} />
                            ) : null}
                            <strong>{entry.recipe.record.title}</strong>
                            {time && (
                              <small className="planner-time">
                                <Clock3 size={12} />
                                {time.minutes} min
                                {time.label === 'Total time'
                                  ? ''
                                  : time.label === 'Prep time'
                                    ? ' prep'
                                    : ' cook'}
                              </small>
                            )}
                          </a>
                          {entry.note && <p className="planner-note">{entry.note}</p>}
                          <div className="planner-entry-menu">
                            <button
                              id={`meal-menu-${entry.id}`}
                              className="icon-button"
                              aria-label={`Options for ${entry.recipe.record.title}`}
                              aria-expanded={menu === entry.id}
                              onClick={() => setMenu(menu === entry.id ? undefined : entry.id)}
                            >
                              <Menu size={16} />
                            </button>
                            {menu === entry.id && (
                              <div className="planner-menu-actions">
                                <button
                                  onClick={() => {
                                    setEditing({ entry, mode: 'move' });
                                    setMenu(undefined);
                                  }}
                                >
                                  Move to date / meal
                                </button>
                                <button
                                  onClick={() => {
                                    setEditing({ entry, mode: 'note' });
                                    setMenu(undefined);
                                  }}
                                >
                                  Edit note
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={async () => {
                                    setBusy(true);
                                    setError('');
                                    try {
                                      await api(`/planner/${entry.id}`, { method: 'DELETE' });
                                      setMenu(undefined);
                                      setNotice('Recipe removed from meal plan.');
                                      refresh();
                                    } catch (error) {
                                      setError(errorMessage(error));
                                    } finally {
                                      setBusy(false);
                                    }
                                  }}
                                >
                                  Remove from meal plan
                                </button>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  {day && !loading && notes.length > 0 && (
                    <aside className="planner-meal-notes">
                      <h3>Meal notes</h3>
                      {notes.map((entry) => (
                        <p key={entry.id}>
                          <strong>{entry.recipe.record.title}</strong>
                          <span>{entry.note}</span>
                        </p>
                      ))}
                    </aside>
                  )}
                </section>
              );
            })}
          </section>
        ))}
      </div>
      <p className="planner-retention">
        Private to your account. Plans older than one month are automatically deleted.
      </p>
      {picker && (
        <RecipePicker
          target={picker}
          close={() => setPicker(undefined)}
          added={refresh}
          create={() => {
            createRecipe(picker);
            setPicker(undefined);
          }}
        />
      )}
      {month && (
        <MonthPicker
          selected={date}
          close={() => setMonth(false)}
          choose={(date) => {
            setMonth(false);
            navigate(plannerUrl(date));
          }}
        />
      )}
      {editing && (
        <EntryEditor
          {...editing}
          close={() => setEditing(undefined)}
          changed={() => {
            setEditing(undefined);
            setNotice(editing.mode === 'move' ? 'Recipe moved.' : 'Note saved.');
            refresh();
          }}
        />
      )}
    </section>
  );
}
