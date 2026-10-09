import { retryMessage as errorMessage } from '../../errors';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, post } from '../../api';
import { Modal, Notice } from '../../components';
import type { RecipeView } from '../../../shared/atproto';
import {
  addDays,
  dateObject,
  localDate,
  mealLabels,
  mealSlots,
  retentionStart,
  weekStart,
  type MealEntry,
  type MealSlot,
  type MealTarget,
  type PlannerSettings,
} from '../../../shared/planner';
import { displayDate } from './navigation';

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

export function EntryEditor({
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

export function MonthPicker({
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
