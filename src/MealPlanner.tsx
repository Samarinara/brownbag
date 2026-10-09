import { retryMessage as errorMessage } from './errors';
import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Menu,
  Plus,
  ShoppingBasket,
} from 'lucide-react';
import { shoppingUrl } from '../shared/shopping';
import { api } from './api';
import { Notice } from './components';
import { RecipePicker } from './features/planner/RecipePicker';
import { EntryEditor, MonthPicker } from './features/planner/PlannerDialogs';
import { displayDate } from './features/planner/navigation';
import { RecipeImage, recipeTime } from './RecipePresentation';
import {
  addDays,
  calendarDateSchema,
  localDate,
  mealLabels,
  mealSlots,
  retentionStart,
  plannerUrl,
  weekStart,
  type MealEntry,
  type MealTarget,
} from '../shared/planner';

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
          <h1>Meal Planner</h1>
          <a
            className="button secondary"
            href={shoppingUrl()}
            onClick={(event) => {
              event.preventDefault();
              navigate(shoppingUrl());
            }}
          >
            <ShoppingBasket size={16} aria-hidden="true" /> Shopping list
          </a>
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
