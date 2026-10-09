import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import './shopping.css';
import { defaultPlannerUrl, displayDate } from './MealPlanner';
import { localDate } from '../shared/planner';
import {
  shoppingEnd,
  shoppingRangeSchema,
  shoppingUrl,
  type ShoppingItem,
  type ShoppingList as ShoppingListData,
} from '../shared/shopping';

function amount(item: ShoppingItem) {
  if (item.quantity === null) return '';
  let value = Number(item.quantity);
  let unit = item.unit;
  if (value >= 1000 && (unit === 'g' || unit === 'ml')) {
    value /= 1000;
    unit = unit === 'g' ? 'kg' : 'l';
  }
  const rounded = Math.round(value * 1000) / 1000;
  return `${rounded !== value ? '≈ ' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;
}
const message = (error: unknown) => (error instanceof Error ? error.message : 'Please try again.');

export function ShoppingList({
  route,
  navigate,
}: {
  route: string;
  navigate: (url: string) => void;
}) {
  const params = new URL(route, location.origin).searchParams;
  const parsed = shoppingRangeSchema.safeParse({
    from: params.get('from') || localDate(),
    days: params.get('days') || 7,
  });
  const range = parsed.success ? parsed.data : { from: localDate(), days: 7 };
  const [today, setToday] = useState(localDate);
  const from = range.from < today ? today : range.from;
  const days = range.days;
  const to = shoppingEnd(from, days);
  const [list, setList] = useState<ShoppingListData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [dayInput, setDayInput] = useState(String(days));
  const generation = useRef(0);
  const saving = useRef(new Set<string>());
  useEffect(() => setDayInput(String(days)), [days]);
  useEffect(() => {
    const refresh = () => {
      setToday(localDate());
      if (!document.hidden && !saving.current.size) setRevision((value) => value + 1);
    };
    const timer = setInterval(() => setToday(localDate()), 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    setNotice('');
    const timer = setTimeout(() => {
      api<ShoppingListData>(
        `/planner/shopping-list?${new URLSearchParams({ from, days: String(days) })}`,
      )
        .then((value) => {
          if (current === generation.current) setList(value);
        })
        .catch((error) => {
          if (current === generation.current) setError(message(error));
        })
        .finally(() => {
          if (current === generation.current) setLoading(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [from, days, revision]);
  async function check(item: ShoppingItem, checked: boolean) {
    if (saving.current.has(item.groupKey)) return;
    const current = generation.current;
    saving.current.add(item.groupKey);
    setPending(new Set(saving.current));
    setError('');
    setNotice('');
    try {
      const updated = await api<ShoppingListData>('/planner/shopping-list/check', {
        method: 'PUT',
        body: JSON.stringify({ from, days, key: item.key, fingerprint: item.fingerprint, checked }),
      });
      if (current === generation.current) {
        setList(updated);
        setNotice('Purchase saved.');
      }
    } catch (error) {
      if (current === generation.current) setError(message(error));
    } finally {
      saving.current.delete(item.groupKey);
      setPending(new Set(saving.current));
      if (current !== generation.current) setRevision((value) => value + 1);
    }
  }
  function changeDays(value: string) {
    setDayInput(value);
    const number = Number(value);
    if (value && Number.isInteger(number) && number >= 1 && number <= 93 && number !== days) {
      navigate(shoppingUrl(from, number));
    }
  }
  const current = list?.from === from && list.days === days && !loading;
  return (
    <section className="meal-planner shopping-list">
      <a
        className="shopping-back"
        href={defaultPlannerUrl()}
        onClick={(event) => {
          event.preventDefault();
          navigate(defaultPlannerUrl());
        }}
      >
        <ArrowLeft size={16} aria-hidden="true" /> Meal Planner
      </a>
      <div className="planner-heading">
        <div>
          <h1>Shopping list</h1>
          <p className="muted">Everything you need for your planned meals.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh shopping list"
          disabled={loading || pending.size > 0}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="shopping-range">
        <label htmlFor="shopping-days">Days to shop for</label>
        <div className="shopping-range-inputs">
          <input
            type="range"
            aria-label="Days to shop for slider"
            min="1"
            max="93"
            value={days}
            onChange={(event) => changeDays(event.target.value)}
          />
          <input
            id="shopping-days"
            type="number"
            min="1"
            max="93"
            step="1"
            value={dayInput}
            onChange={(event) => changeDays(event.target.value)}
            onBlur={() => setDayInput(String(days))}
          />
        </div>
        <p>
          {displayDate(from, { month: 'short', day: 'numeric', year: 'numeric' })} –{' '}
          {displayDate(to, { month: 'short', day: 'numeric', year: 'numeric' })} · {days}{' '}
          {days === 1 ? 'day' : 'days'}
        </p>
      </div>
      <Notice error={error} />
      <p className="planner-status" role="status" aria-live="polite">
        {loading
          ? 'Building your shopping list…'
          : notice ||
            (current
              ? `${list.items.filter((item) => item.checked).length} of ${list.items.length} items bought · ${list.mealCount} planned meals`
              : '')}
      </p>
      {current &&
        (list.items.length ? (
          <ul className="shopping-items">
            {list.items.map((item) => (
              <li key={item.key} className={item.checked ? 'is-bought' : ''}>
                <label>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    disabled={pending.has(item.groupKey)}
                    onChange={(event) => void check(item, event.target.checked)}
                  />
                  <span className="shopping-item-name">
                    {item.ingredient}
                    {item.unspecified.length > 0 && (
                      <small>Also needed: {item.unspecified.join('; ')}</small>
                    )}
                  </span>
                  <span className="shopping-item-amount">{amount(item)}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <div className="shopping-empty">
            <h2>No meals planned in this range</h2>
            <p>Add recipes to your Meal Planner to build your shopping list.</p>
          </div>
        ))}
      <p className="hint">
        Quantities cover each planned recipe in full. Compatible units are combined; cups and spoons
        use US measures. Weight and volume stay separate.
      </p>
      <p className="hint">
        Purchases stay checked. Extra quantities appear as separate items to buy. Quantities leave
        the list after their planned meal date.
      </p>
    </section>
  );
}
