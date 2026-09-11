import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X, Plus, Trash2, ArrowRight } from 'lucide-react';
import { api, post } from './api';
import { recipeSchema, type Recipe, type RecipeInput, type User } from '../shared/schema';

export function Bag({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 27 : 52}
      height={small ? 32 : 60}
      viewBox="0 0 52 60"
      fill="none"
      aria-hidden="true"
    >
      <path d="M10 18h32l4 36H6l4-36Z" fill="currentColor" />
      <path d="M17 20V12a9 9 0 0 1 18 0v8" stroke="currentColor" strokeWidth="4" />
      <path
        d="m19 34 5 5 10-11"
        stroke="var(--paper)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={wide ? 'modal wide' : 'modal'}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="Close dialog">
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Notice({ error }: { error: string }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}
export function Login({ done, close }: { done: (user: User) => void; close: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [emailAuth, setEmailAuth] = useState<boolean | null>(null);
  const [consoleMail, setConsoleMail] = useState(false);
  useEffect(() => {
    api<{ emailAuth: boolean; mailMode?: string }>('/auth/config')
      .then((c) => {
        setEmailAuth(c.emailAuth);
        setConsoleMail(c.emailAuth && c.mailMode === 'console');
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (emailAuth === false) done(await post<User>('/auth/password', { email, password }));
      else if (sent) done(await post<User>('/auth/verify', { email, code }));
      else {
        await post('/auth/code', { email });
        setSent(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (emailAuth === null)
    return (
      <Modal title="A little space for your recipes" close={close}>
        <p className="muted">Loading sign-in…</p>
        <Notice error={error} />
      </Modal>
    );
  return (
    <Modal
      title={emailAuth && sent ? 'Check your inbox' : 'A little space for your recipes'}
      close={close}
    >
      <p className="muted">
        {!emailAuth
          ? 'Sign in with your email and password. If this email is new, we’ll create your private collection.'
          : sent
            ? `We sent an 8-digit sign-in code to ${email}. It expires in 10 minutes.`
            : 'Sign in or create your private collection with just your email. No password to remember.'}
      </p>
      <form onSubmit={submit} className="stack">
        <label>
          {emailAuth && sent ? 'Verification code' : 'Email address'}
          {emailAuth && sent ? (
            <input
              autoFocus
              key="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{8}"
              maxLength={8}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="00000000"
            />
          ) : (
            <input
              autoFocus
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          )}
        </label>
        {!emailAuth && (
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 12 characters"
            />
          </label>
        )}
        <Notice error={error} />
        <button className="button primary" disabled={busy}>
          {busy ? 'One moment…' : !emailAuth || sent ? 'Open my brownbag' : 'Send me a code'}
          <ArrowRight size={17} />
        </button>
        {emailAuth && sent && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setSent(false);
              setCode('');
              setError('');
            }}
          >
            Use another email or request a new code
          </button>
        )}
        {consoleMail && (
          <p className="hint">
            Local development: your code appears in the server terminal instead of an email.
          </p>
        )}
      </form>
    </Modal>
  );
}
const blank: RecipeInput = {
  title: '',
  shortDescription: '',
  longDescription: '',
  ingredients: [{ quantity: null, unit: '', ingredient: '', note: '' }],
  steps: [{ text: '' }],
  tags: [],
  servings: null,
  prepMinutes: null,
  cookMinutes: null,
  sourceUrl: '',
  notes: '',
  metadata: {},
};
export function RecipeEditor({
  recipe,
  close,
  saved,
}: {
  recipe?: Recipe;
  close: () => void;
  saved: (recipe: Recipe) => void;
}) {
  const [form, setForm] = useState<RecipeInput>(() =>
    recipe
      ? (Object.fromEntries(
          Object.keys(blank).map((key) => [key, recipe[key as keyof RecipeInput]]),
        ) as RecipeInput)
      : structuredClone(blank),
  );
  const [tags, setTags] = useState(form.tags.join(', '));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = <K extends keyof RecipeInput>(key: K, value: RecipeInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const parsed = recipeSchema.safeParse({
        ...form,
        tags: [
          ...new Set(
            tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ],
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        );
      const result = await post<{ recipe: Recipe }>(
        '/changes',
        recipe
          ? {
              action: 'update',
              recipeId: recipe.id,
              baseVersion: recipe.version,
              data: parsed.data,
            }
          : { action: 'create', data: parsed.data },
      );
      saved(result.recipe);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={recipe ? 'Edit recipe' : 'Something worth keeping'} close={close} wide>
      <form className="stack recipe-form" onSubmit={submit}>
        <label>
          Recipe title
          <input
            required
            maxLength={200}
            autoFocus
            placeholder="Grandma’s Sunday pancakes"
            value={form.title}
            onChange={(e) => field('title', e.target.value)}
          />
        </label>
        <label>
          A short description
          <textarea
            maxLength={300}
            rows={2}
            placeholder="A sentence or two about what makes it good."
            value={form.shortDescription}
            onChange={(e) => field('shortDescription', e.target.value)}
          />
        </label>
        <div className="form-row">
          {(['servings', 'prepMinutes', 'cookMinutes'] as const).map((key, i) => (
            <label key={key}>
              {['Servings', 'Prep time (min)', 'Cook time (min)'][i]}
              <input
                type="number"
                min={key === 'servings' ? 0.1 : 0}
                step={key === 'servings' ? 'any' : 1}
                value={form[key] ?? ''}
                onChange={(e) => field(key, e.target.value === '' ? null : Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <fieldset>
          <legend>Ingredients</legend>
          <p className="hint">Leave quantity blank for ingredients added to taste.</p>
          {form.ingredients.map((item, i) => (
            <div className="ingredient-editor" key={i}>
              <input
                aria-label={`Ingredient ${i + 1} quantity`}
                placeholder="Qty"
                type="number"
                min="0"
                step="any"
                value={item.quantity ?? ''}
                onChange={(e) =>
                  field(
                    'ingredients',
                    form.ingredients.map((x, j) =>
                      j === i
                        ? { ...x, quantity: e.target.value === '' ? null : Number(e.target.value) }
                        : x,
                    ),
                  )
                }
              />
              <input
                aria-label={`Ingredient ${i + 1} unit`}
                placeholder="Unit"
                value={item.unit}
                onChange={(e) =>
                  field(
                    'ingredients',
                    form.ingredients.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)),
                  )
                }
              />
              <input
                aria-label={`Ingredient ${i + 1} name`}
                placeholder="Ingredient"
                required
                value={item.ingredient}
                onChange={(e) =>
                  field(
                    'ingredients',
                    form.ingredients.map((x, j) =>
                      j === i ? { ...x, ingredient: e.target.value } : x,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ingredient ${i + 1}`}
                disabled={form.ingredients.length === 1}
                onClick={() =>
                  field(
                    'ingredients',
                    form.ingredients.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
              <input
                className="ingredient-note"
                aria-label={`Ingredient ${i + 1} note`}
                placeholder="Optional note, e.g. finely chopped"
                value={item.note}
                onChange={(e) =>
                  field(
                    'ingredients',
                    form.ingredients.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)),
                  )
                }
              />
            </div>
          ))}
          <button
            type="button"
            className="text-button"
            onClick={() =>
              field('ingredients', [
                ...form.ingredients,
                { quantity: null, unit: '', ingredient: '', note: '' },
              ])
            }
          >
            <Plus size={15} />
            Add ingredient
          </button>
        </fieldset>
        <fieldset>
          <legend>Step by step</legend>
          {form.steps.map((step, i) => (
            <div className="step-editor" key={i}>
              <span>{i + 1}</span>
              <textarea
                aria-label={`Step ${i + 1}`}
                rows={2}
                required
                placeholder="What happens next?"
                value={step.text}
                onChange={(e) =>
                  field(
                    'steps',
                    form.steps.map((x, j) => (j === i ? { text: e.target.value } : x)),
                  )
                }
              />
              <div className="step-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move step ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => {
                    const steps = [...form.steps];
                    [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                    field('steps', steps);
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove step ${i + 1}`}
                  disabled={form.steps.length === 1}
                  onClick={() =>
                    field(
                      'steps',
                      form.steps.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="text-button"
            onClick={() => field('steps', [...form.steps, { text: '' }])}
          >
            <Plus size={15} />
            Add step
          </button>
        </fieldset>
        <label>
          Tags
          <input
            placeholder="Weeknight, Vegetarian, Family favorite"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <span className="hint">Separate tags with commas.</span>
        </label>
        <details>
          <summary>
            The story & other details <span className="muted">Optional</span>
          </summary>
          <div className="stack">
            <label>
              Long description
              <textarea
                rows={4}
                value={form.longDescription}
                onChange={(e) => field('longDescription', e.target.value)}
                placeholder="The story behind the recipe, serving suggestions, or a few helpful tips."
              />
            </label>
            <label>
              Notes
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => field('notes', e.target.value)}
              />
            </label>
            <label>
              Source URL
              <input
                type="url"
                placeholder="https://…"
                value={form.sourceUrl}
                onChange={(e) => field('sourceUrl', e.target.value)}
              />
            </label>
          </div>
        </details>
        <Notice error={error} />
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={close}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save recipe'}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
