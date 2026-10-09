import { readRecovery, recoveryKey, removeRecovery, writeRecovery } from './offline-storage';
import {
  readPublicationIntent,
  persistPublicationIntent,
  removePublicationIntent,
  releaseConfirmedPublicationConflict,
  type PublicationIntent,
} from './publication-operation';
import { ApiError } from './api';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { api, post } from './api';
import { Notice } from './components';
import { RecipeCategory } from './RecipeCategory';
import { mealLabels, retentionStart, targetFromRoute } from '../shared/planner';
import { displayDate } from './MealPlanner';
import {
  draftInputSchema,
  recipeInputSchema,
  type RecipeInput,
  type RecipeView,
} from '../shared/atproto';
import { message, type Editing } from './NetworkApp';
import {
  adaptRecipe,
  blankRecipe,
  editableRecipe,
  fitsPublishedRecord,
  photoSchema,
  recipeIssueLabel,
} from './recipe-editor';

function IngredientTextInput({
  kind,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { kind: 'ingredient' | 'unit' }) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (!focused) return;
    const controller = new AbortController();
    setSuggestions([]);
    const timer = setTimeout(() => {
      void api<{ suggestions: { value: string }[] }>(
        `/ingredients/suggestions?${new URLSearchParams({ kind, q: String(props.value || '') })}`,
        { signal: controller.signal },
      )
        .then(({ suggestions }) => {
          if (!controller.signal.aborted) setSuggestions(suggestions.map((item) => item.value));
        })
        .catch(() => {
          // Text entry remains available offline or when suggestions cannot load.
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [focused, kind, props.value]);
  return (
    <>
      <input
        {...props}
        list={id}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <datalist id={id}>
        {suggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    </>
  );
}

type Props = {
  route: string;
  userDid: string;
  preview?: boolean;
  close: () => void;
  done: (recipe?: RecipeView) => void;
  leaveGuard: RefObject<() => boolean>;
};

export function NetworkEditorPage(props: Props) {
  const [editing, setEditing] = useState<Editing>();
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const url = new URL(props.route, location.origin);
      if (props.preview || url.pathname === '/recipe/new') return { data: blankRecipe() };
      if (url.pathname === '/recipe/draft') {
        const intent = readPublicationIntent(recoveryKey(props.userDid, props.route));
        if (intent?.draftId === url.searchParams.get('id'))
          return { data: intent.recipe, draftId: intent.draftId };
        const { drafts } = await api<{ drafts: { id: string; data: RecipeInput }[] }>('/drafts');
        const draft = drafts.find((item) => item.id === url.searchParams.get('id'));
        if (!draft) throw new Error('This draft could not be found.');
        return { data: draft.data, draftId: draft.id };
      }
      const uri = url.searchParams.get('uri');
      if (!uri) throw new Error('Choose a recipe to edit.');
      const recipe = await api<RecipeView>(
        `/recipe?uri=${encodeURIComponent(uri)}&fresh=${Date.now()}`,
      );
      if (url.pathname === '/recipe/adapt')
        return { data: adaptRecipe(recipe.record, recipe.uri, recipe.cid) };
      if (recipe.authorDid !== props.userDid)
        throw new Error('You can only edit your own recipes.');
      return { data: editableRecipe(recipe.record), original: recipe };
    };
    void load()
      .then((data) => {
        if (alive) setEditing(data);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    return () => {
      alive = false;
    };
  }, [props.route, props.userDid, props.preview]);
  if (!editing)
    return (
      <section className="network-editor-page">
        <button className="text-button" onClick={props.close}>
          <ArrowLeft size={16} /> Back to recipes
        </button>
        {error ? (
          <Notice error={error} />
        ) : (
          <>
            <p className="sr-only" role="status">
              Opening your recipe…
            </p>
            <div aria-hidden="true">
              <div className="skeleton skeleton-line short" />
              <div className="skeleton skeleton-line hero" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line narrow" />
            </div>
          </>
        )}
      </section>
    );
  return <NetworkEditor key={`${props.userDid}:${props.route}`} {...props} editing={editing} />;
}

function Disclosure({
  title,
  hint,
  label,
  populated,
  children,
}: {
  title: string;
  hint?: string;
  label?: string;
  populated?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="recipe-disclosure" open={populated || undefined}>
      <summary aria-label={label}>
        <span>{title}</span>
        {hint && <small>{hint}</small>}
      </summary>
      <div className="stack">{children}</div>
    </details>
  );
}

function NetworkEditor({
  editing,
  close,
  done,
  leaveGuard,
  route,
  userDid,
  preview = false,
}: Props & { editing: Editing }) {
  const plannerTarget = targetFromRoute(route);
  const plannedId = useRef(crypto.randomUUID());
  const [published, setPublished] = useState<RecipeView>();
  const [data, setData] = useState<RecipeInput>(() => editableRecipe(editing.data));
  const rowKeys = useRef({
    ingredients: data.ingredients.map(() => crypto.randomUUID()),
    instructions: data.instructions.map(() => crypto.randomUUID()),
  });
  const initial = useRef(JSON.stringify(data));
  const deviceKey = recoveryKey(userDid, route);
  const publicationIntent = useRef<PublicationIntent | undefined>(
    preview ? undefined : readPublicationIntent(deviceKey),
  );
  const [recovery, setRecovery] = useState(() =>
    preview ? undefined : readRecovery(deviceKey) || publicationIntent.current?.recipe,
  );
  const [recoveryStatus, setRecoveryStatus] = useState('');
  const completed = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [photoPreviews, setPhotoPreviews] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const errorsRef = useRef<HTMLDivElement>(null);
  const [issues, setIssues] = useState<{ path: PropertyKey[]; message: string }[]>([]);
  const dirty = JSON.stringify(data) !== initial.current;
  useEffect(() => {
    if (preview || recovery || completed.current) return;
    if (!dirty && !publicationIntent.current) {
      removeRecovery(deviceKey);
      return;
    }
    const saved = writeRecovery(deviceKey, data);
    setRecoveryStatus(
      saved
        ? 'Backed up on this device'
        : 'Device backup is unavailable. Save a private draft before leaving.',
    );
  }, [data, dirty, deviceKey, recovery, preview]);
  useEffect(() => {
    const cleared = () => {
      publicationIntent.current = undefined;
      setRecovery(undefined);
      setRecoveryStatus('Device backup cleared.');
    };
    window.addEventListener('brownbag-device-data-cleared', cleared);
    return () => window.removeEventListener('brownbag-device-data-cleared', cleared);
  }, []);
  const finishRecovery = () => {
    completed.current = true;
    removeRecovery(deviceKey);
    removePublicationIntent(deviceKey);
    publicationIntent.current = undefined;
  };
  const update = <K extends keyof RecipeInput>(key: K, value: RecipeInput[K]) =>
    setData((old) => ({ ...old, [key]: value }));
  const addRow = (kind: 'ingredients' | 'instructions') => {
    const index = data[kind].length;
    rowKeys.current[kind].push(crypto.randomUUID());
    if (kind === 'ingredients') update(kind, [...data.ingredients, { name: '' }]);
    else update(kind, [...data.instructions, { text: '' }]);
    requestAnimationFrame(() => {
      formRef.current
        ?.querySelector<HTMLElement>(
          `[name="${kind}.${index}.${kind === 'ingredients' ? 'name' : 'text'}"]`,
        )
        ?.focus();
    });
  };
  const ingredient = (index: number, patch: Partial<RecipeInput['ingredients'][number]>) =>
    update(
      'ingredients',
      data.ingredients.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const step = (index: number, patch: Partial<RecipeInput['instructions'][number]>) =>
    update(
      'instructions',
      data.instructions.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const photo = (index: number, patch: Partial<NonNullable<RecipeInput['images']>[number]>) =>
    update(
      'images',
      data.images?.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const move = <T,>(items: T[], index: number, direction: number): T[] => {
    const next = [...items];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    return next;
  };
  const reorderRow = (kind: 'ingredients' | 'instructions', index: number, direction: number) => {
    rowKeys.current[kind] = move(rowKeys.current[kind], index, direction);
    if (kind === 'ingredients') update(kind, move(data.ingredients, index, direction));
    else update(kind, move(data.instructions, index, direction));
  };
  const removeRow = (kind: 'ingredients' | 'instructions', index: number) => {
    rowKeys.current[kind].splice(index, 1);
    if (kind === 'ingredients')
      update(
        kind,
        data.ingredients.filter((_, i) => i !== index),
      );
    else
      update(
        kind,
        data.instructions.filter((_, i) => i !== index),
      );
  };
  useEffect(() => {
    leaveGuard.current = () =>
      !busy &&
      (!dirty ||
        window.confirm(
          published
            ? 'Your recipe is published but has not been added to the meal plan. Leave the editor?'
            : 'Leave this recipe? Changes have not been saved to your account.',
        ));
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      leaveGuard.current = () => true;
      window.removeEventListener('beforeunload', unload);
    };
  }, [dirty, busy, leaveGuard, published]);
  const previewUrls = useRef<string[]>([]);
  useEffect(() => () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useEffect(() => {
    if (issues.length || error) errorsRef.current?.focus();
  }, [issues, error]);
  const revealIssue = (path: PropertyKey[]) => {
    const name = path.map(String).join('.');
    const control = Array.from(formRef.current?.querySelectorAll<HTMLElement>('[name]') || []).find(
      (node) =>
        node.getAttribute('name') === name || node.getAttribute('name')?.startsWith(`${name}.`),
    );
    if (control) {
      let parent = control.parentElement;
      while (parent) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      control.focus();
      control.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };
  const save = async (publish: boolean) => {
    if (preview) return;
    setError('');
    setIssues([]);
    if (publish && plannerTarget && plannerTarget.date < retentionStart()) {
      setError(
        'This meal date has expired. Save a private draft and choose a more recent date from the planner.',
      );
      return;
    }
    if (publish && published && plannerTarget) {
      setBusy(true);
      try {
        await post('/planner', { ...plannerTarget, uri: published.uri, id: plannedId.current });
        leaveGuard.current = () => true;
        finishRecovery();
        done(published);
      } catch (error) {
        setError(
          `Your recipe is published, but could not be added to the meal plan: ${message(error)} Retry adding it below.`,
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    const checked = (publish ? recipeInputSchema : draftInputSchema).safeParse(data);
    if (!checked.success) {
      setIssues(checked.error.issues);
      return;
    }
    if (publish && !fitsPublishedRecord(checked.data, editing.original?.record)) {
      setError(
        'This recipe is too long to publish. Shorten the text to fit the 128 KiB publication limit, or save a private draft.',
      );
      return;
    }
    setBusy(true);
    try {
      let result: RecipeView | undefined;
      if (publish) {
        const sendIntent = (intent: PublicationIntent) =>
          intent.existing
            ? api<RecipeView>('/recipe', {
                method: 'PUT',
                headers: { 'Idempotency-Key': intent.id },
                body: JSON.stringify({ ...intent.existing, recipe: intent.recipe }),
              })
            : post<RecipeView>('/recipes', {
                recipe: intent.recipe,
                draftId: intent.draftId,
                operationId: intent.id,
              });
        let intent = publicationIntent.current;
        if (!intent) {
          intent = {
            id: crypto.randomUUID(),
            recipe: checked.data,
            ...(editing.original
              ? { existing: { uri: editing.original.uri, cid: editing.original.cid } }
              : {}),
            ...(editing.draftId ? { draftId: editing.draftId } : {}),
          };
          persistPublicationIntent(deviceKey, intent);
          publicationIntent.current = intent;
        }
        result = await sendIntent(intent);
        // If content changed after an uncertain response, confirm the earlier
        // operation first, then save the new content to that same recipe.
        if (JSON.stringify(intent.recipe) !== JSON.stringify(checked.data)) {
          intent = {
            id: crypto.randomUUID(),
            recipe: checked.data,
            existing: { uri: result.uri, cid: result.cid },
          };
          persistPublicationIntent(deviceKey, intent);
          publicationIntent.current = intent;
          result = await sendIntent(intent);
        }
        finishRecovery();
        if (plannerTarget) {
          setPublished(result);
          try {
            await post('/planner', { ...plannerTarget, uri: result.uri, id: plannedId.current });
          } catch (error) {
            setError(
              `Your recipe is published, but could not be added to the meal plan: ${message(error)} Retry adding it below.`,
            );
            return;
          }
        }
      } else if (publicationIntent.current) {
        throw new Error(
          'An earlier publication has not been confirmed. Retry Publish to recover it before saving a private draft.',
        );
      } else if (editing.draftId) {
        try {
          await api(`/drafts/${encodeURIComponent(editing.draftId)}`, {
            method: 'PUT',
            body: JSON.stringify({ data: checked.data }),
          });
        } catch (error) {
          // A confirmed earlier create may already have removed its private draft.
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
          await post('/drafts', { data: checked.data });
        }
      } else await post('/drafts', { data: checked.data });
      leaveGuard.current = () => true;
      finishRecovery();
      done(result);
    } catch (e) {
      const intent = publicationIntent.current;
      if (
        e instanceof ApiError &&
        e.status === 409 &&
        intent &&
        (await releaseConfirmedPublicationConflict(deviceKey, intent, (id) =>
          api(`/publication-operations/${encodeURIComponent(id)}`),
        ))
      ) {
        if (publicationIntent.current?.id === intent.id) publicationIntent.current = undefined;
        writeRecovery(deviceKey, data);
        setError(
          `${message(e)} Your edits are preserved. Save a private draft or reload the current recipe before publishing again.`,
        );
      } else setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const upload = async (files: FileList | null) => {
    if (preview || !files?.length) return;
    setError('');
    if ((data.images?.length || 0) + files.length > 8) {
      setError('You can add up to 8 photos.');
      return;
    }
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (
          !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) ||
          !file.size ||
          file.size > 5_000_000
        )
          throw new Error('Choose a JPEG, PNG, WebP or AVIF photo up to 5 MB.');
        const result = await api<{ image: NonNullable<RecipeInput['images']>[number]['image'] }>(
          '/images',
          { method: 'POST', headers: { 'Content-Type': file.type }, body: file },
        );
        const entry = photoSchema.parse({ image: result.image, alt: '' });
        const preview = URL.createObjectURL(file);
        previewUrls.current.push(preview);
        setPhotoPreviews((old) => ({ ...old, [entry.image.ref.$link]: preview }));
        setData((old) => ({ ...old, images: [...(old.images || []), entry] }));
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const categorySuggestions = (kind: 'ingredients' | 'instructions', index: number) =>
    [
      ...new Map(
        [
          ...data.ingredients.filter((_, i) => kind !== 'ingredients' || i !== index),
          ...data.instructions.filter((_, i) => kind !== 'instructions' || i !== index),
        ]
          .map((item) => item.group?.trim())
          .filter((group): group is string => !!group)
          .map((group) => [group.toLocaleLowerCase(), group] as const)
          .reverse(),
      ).values(),
    ].reverse();
  const rowActions = (
    label: string,
    index: number,
    length: number,
    reorder: (direction: number) => void,
    remove: () => void,
    minimum = 1,
  ) => (
    <div className="recipe-row-actions">
      <button
        type="button"
        className="icon-button"
        aria-label={`Move ${label} ${index + 1} up`}
        title={`Move ${label} ${index + 1} up`}
        disabled={index === 0}
        onClick={() => reorder(-1)}
      >
        <ArrowUp size={15} />
      </button>
      <button
        type="button"
        className="icon-button danger"
        aria-label={`Remove ${label} ${index + 1}`}
        title={`Remove ${label} ${index + 1}`}
        disabled={length <= minimum}
        onClick={remove}
      >
        <Trash2 size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={`Move ${label} ${index + 1} down`}
        title={`Move ${label} ${index + 1} down`}
        disabled={index === length - 1}
        onClick={() => reorder(1)}
      >
        <ArrowDown size={15} />
      </button>
    </div>
  );
  return (
    <article className="network-editor-page">
      <button className="text-button recipe-back" onClick={close}>
        <ArrowLeft size={16} /> {plannerTarget ? 'Back to Meal Planner' : 'Back to recipes'}
      </button>
      <header className="recipe-editor-heading">
        <h1>{editing.original ? 'Edit recipe' : editing.draftId ? 'Edit draft' : 'New recipe'}</h1>
        {plannerTarget && (
          <div className="planner-editor-destination">
            <strong>
              Creating for {displayDate(plannerTarget.date)} · {mealLabels[plannerTarget.slot]}
            </strong>
            <p>
              Publishing adds this recipe to your meal plan and returns you to that week. Saving a
              private draft does not add it.
            </p>
          </div>
        )}
      </header>
      {recovery && (
        <div className="recovery-notice" role="status">
          <p>There are unsaved changes from an earlier visit on this device.</p>
          <button
            className="button secondary"
            onClick={() => {
              rowKeys.current = {
                ingredients: recovery.ingredients.map(() => crypto.randomUUID()),
                instructions: recovery.instructions.map(() => crypto.randomUUID()),
              };
              setData(editableRecipe(recovery));
              setRecovery(undefined);
            }}
          >
            Restore changes
          </button>{' '}
          <button
            className="text-button"
            onClick={() => {
              if (publicationIntent.current) {
                setError(
                  'An earlier publication has not been confirmed. Restore changes and retry Publish before discarding this backup.',
                );
                return;
              }
              removeRecovery(deviceKey);
              setRecovery(undefined);
            }}
          >
            Discard backup
          </button>
        </div>
      )}
      <form
        ref={formRef}
        className="network-editor"
        inert={!!recovery}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!preview && confirmed && !busy) void save(true);
        }}
      >
        <fieldset disabled={busy || !!published} className="recipe-editor-fields">
          <section className="recipe-editor-section stack">
            <label>
              Recipe title
              <input
                name="title"
                value={data.title}
                onChange={(e) => update('title', e.target.value)}
                placeholder="Lemon pasta"
              />
            </label>
            <Disclosure title="Introduction" populated={!!editing.data.summary}>
              <label>
                Short description
                <textarea
                  name="summary"
                  rows={2}
                  value={data.summary || ''}
                  onChange={(e) => update('summary', e.target.value || undefined)}
                />
              </label>
            </Disclosure>
          </section>
          <section className="recipe-editor-section">
            <div className="recipe-section-heading">
              <h2>Ingredients</h2>
            </div>
            {data.ingredients.map((item, index) => (
              <div className="recipe-ingredient-row" key={rowKeys.current.ingredients[index]}>
                <div className="recipe-ingredient-fields">
                  <label>
                    <span>Quantity</span>
                    <input
                      name={`ingredients.${index}.quantity`}
                      aria-label={`Ingredient ${index + 1} quantity`}
                      placeholder="1 ½"
                      value={item.quantity || ''}
                      onChange={(e) => ingredient(index, { quantity: e.target.value || undefined })}
                    />
                  </label>
                  <label>
                    Unit
                    <IngredientTextInput
                      kind="unit"
                      name={`ingredients.${index}.unit`}
                      aria-label={`Ingredient ${index + 1} unit`}
                      placeholder="cups"
                      value={item.unit || ''}
                      onChange={(e) => ingredient(index, { unit: e.target.value || undefined })}
                    />
                  </label>
                  <label className="recipe-ingredient-name">
                    Ingredient
                    <IngredientTextInput
                      kind="ingredient"
                      name={`ingredients.${index}.name`}
                      aria-label={`Ingredient ${index + 1} name`}
                      placeholder="Flour"
                      value={item.name}
                      onChange={(e) => ingredient(index, { name: e.target.value })}
                    />
                  </label>
                </div>
                <Disclosure
                  title="Preparation"
                  label={`Ingredient ${index + 1} preparation options`}
                  populated={!!editing.data.ingredients[index]?.preparation}
                >
                  <label>
                    <span className="sr-only">Ingredient {index + 1} preparation</span>
                    <input
                      name={`ingredients.${index}.preparation`}
                      placeholder="Finely chopped"
                      value={item.preparation || ''}
                      onChange={(e) =>
                        ingredient(index, { preparation: e.target.value || undefined })
                      }
                    />
                  </label>
                </Disclosure>
                {rowActions(
                  'ingredient',
                  index,
                  data.ingredients.length,
                  (d) => reorderRow('ingredients', index, d),
                  () => removeRow('ingredients', index),
                )}
                <RecipeCategory
                  name={`ingredients.${index}.group`}
                  label={`Ingredient ${index + 1} category`}
                  value={item.group}
                  categories={categorySuggestions('ingredients', index)}
                  onChange={(group) => ingredient(index, { group })}
                />
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              disabled={data.ingredients.length >= 64}
              onClick={() => addRow('ingredients')}
            >
              <Plus size={16} /> Add ingredient
            </button>
          </section>
          <section className="recipe-editor-section">
            <div className="recipe-section-heading">
              <h2>Steps</h2>
            </div>
            {data.instructions.map((item, index) => (
              <div className="recipe-method-row" key={rowKeys.current.instructions[index]}>
                <span className="recipe-step-number">{index + 1}</span>
                <div className="recipe-step-content">
                  <label htmlFor={`recipe-step-${rowKeys.current.instructions[index]}`}>
                    Step {index + 1}
                  </label>
                  <textarea
                    id={`recipe-step-${rowKeys.current.instructions[index]}`}
                    name={`instructions.${index}.text`}
                    rows={3}
                    placeholder="What happens next?"
                    value={item.text}
                    onChange={(e) => step(index, { text: e.target.value })}
                  />
                </div>
                {rowActions(
                  'step',
                  index,
                  data.instructions.length,
                  (d) => reorderRow('instructions', index, d),
                  () => removeRow('instructions', index),
                )}
                <RecipeCategory
                  name={`instructions.${index}.group`}
                  label={`Step ${index + 1} category`}
                  value={item.group}
                  categories={categorySuggestions('instructions', index)}
                  onChange={(group) => step(index, { group })}
                />
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              disabled={data.instructions.length >= 64}
              onClick={() => addRow('instructions')}
            >
              <Plus size={16} /> Add step
            </button>
          </section>
          <section className="recipe-editor-section recipe-extras">
            <h2>Details</h2>
            <Disclosure
              title="Time & servings"
              populated={
                !!(
                  editing.data.yield ||
                  editing.data.prepMinutes !== undefined ||
                  editing.data.cookMinutes !== undefined
                )
              }
            >
              <div className="recipe-fields-pair">
                {(['prepMinutes', 'cookMinutes'] as const).map((key) => (
                  <label key={key}>
                    {key === 'prepMinutes' ? 'Prep time (minutes)' : 'Cook time (minutes)'}
                    <input
                      name={key}
                      type="number"
                      min={0}
                      max={100000}
                      step={1}
                      value={data[key] ?? ''}
                      onChange={(e) =>
                        update(key, e.target.value === '' ? undefined : Number(e.target.value))
                      }
                    />
                  </label>
                ))}
              </div>
              <label>
                Makes
                <input
                  name="yield.display"
                  placeholder="4 servings"
                  value={data.yield?.display || ''}
                  onChange={(e) =>
                    update('yield', { ...data.yield, display: e.target.value || undefined })
                  }
                />
              </label>
              <Disclosure
                title="Separate quantity & unit"
                populated={!!(editing.data.yield?.quantity || editing.data.yield?.unit)}
              >
                <div className="recipe-fields-pair">
                  <label>
                    Yield quantity
                    <input
                      name="yield.quantity"
                      placeholder="12"
                      value={data.yield?.quantity || ''}
                      onChange={(e) =>
                        update('yield', { ...data.yield, quantity: e.target.value || undefined })
                      }
                    />
                  </label>
                  <label>
                    Yield unit
                    <input
                      name="yield.unit"
                      placeholder="cookies"
                      value={data.yield?.unit || ''}
                      onChange={(e) =>
                        update('yield', { ...data.yield, unit: e.target.value || undefined })
                      }
                    />
                  </label>
                </div>
              </Disclosure>
            </Disclosure>
            <Disclosure title="Notes" populated={!!editing.data.description}>
              <label>
                Cooking notes
                <textarea
                  name="description"
                  rows={6}
                  value={data.description || ''}
                  onChange={(e) => update('description', e.target.value || undefined)}
                />
              </label>
            </Disclosure>
            <Disclosure
              title="Tags & language"
              populated={!!(editing.data.tags?.length || editing.data.language)}
            >
              <div className="stack">
                {(data.tags || []).map((tag, index) => (
                  <div className="recipe-tag-row" key={index}>
                    <label>
                      Tag {index + 1}
                      <input
                        name={`tags.${index}`}
                        value={tag}
                        placeholder="Weeknight"
                        onChange={(e) =>
                          update(
                            'tags',
                            data.tags?.map((value, i) => (i === index ? e.target.value : value)),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={`Remove tag ${index + 1}`}
                      title={`Remove tag ${index + 1}`}
                      onClick={() =>
                        update(
                          'tags',
                          data.tags?.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-button"
                  disabled={(data.tags?.length || 0) >= 30}
                  onClick={() => update('tags', [...(data.tags || []), ''])}
                >
                  <Plus size={16} /> Add tag
                </button>
              </div>
              <label>
                Recipe language
                <input
                  name="language"
                  list="recipe-languages"
                  placeholder="en, fr, es, zh-Hant…"
                  value={data.language || ''}
                  onChange={(e) => update('language', e.target.value || undefined)}
                />
                <datalist id="recipe-languages">
                  <option value="en">English</option>
                  <option value="fr">French</option>
                  <option value="es">Spanish</option>
                  <option value="de">German</option>
                  <option value="it">Italian</option>
                  <option value="pt">Portuguese</option>
                  <option value="zh">Chinese</option>
                  <option value="ja">Japanese</option>
                </datalist>
                <small>Choose a language or enter its code.</small>
              </label>
            </Disclosure>
            <Disclosure
              title="Source & inspiration"
              populated={
                !!(editing.data.source || editing.data.derivedFrom || editing.data.adaptationNote)
              }
            >
              <label>
                Source name
                <input
                  name="source.name"
                  placeholder="Family cookbook"
                  value={data.source?.name || ''}
                  onChange={(e) =>
                    update('source', { ...data.source, name: e.target.value || undefined })
                  }
                />
              </label>
              <label>
                Source link
                <input
                  name="source.url"
                  type="url"
                  placeholder="https://…"
                  value={data.source?.url || ''}
                  onChange={(e) =>
                    update('source', { ...data.source, url: e.target.value || undefined })
                  }
                />
              </label>
              <label>
                What did you change?
                <textarea
                  name="adaptationNote"
                  rows={2}
                  value={data.adaptationNote || ''}
                  onChange={(e) => update('adaptationNote', e.target.value || undefined)}
                />
              </label>
              <Disclosure title="Credit a Brownbag recipe" populated={!!editing.data.derivedFrom}>
                <p className="muted">
                  “Make it your own” fills this in for you. You can also enter a recipe’s record
                  address and version.
                </p>
                <label>
                  Original recipe address
                  <input
                    name="derivedFrom.uri"
                    placeholder="at://did:…/page.polli.brownbag.recipe/…"
                    value={data.derivedFrom?.uri || ''}
                    onChange={(e) =>
                      update('derivedFrom', {
                        cid: data.derivedFrom?.cid || '',
                        uri: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Original version (CID)
                  <input
                    name="derivedFrom.cid"
                    value={data.derivedFrom?.cid || ''}
                    onChange={(e) =>
                      update('derivedFrom', {
                        uri: data.derivedFrom?.uri || '',
                        cid: e.target.value,
                      })
                    }
                  />
                </label>
                {data.derivedFrom && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => update('derivedFrom', undefined)}
                  >
                    Remove original recipe credit
                  </button>
                )}
              </Disclosure>
            </Disclosure>
            <Disclosure title="Photos" hint="Up to 8" populated={!!editing.data.images?.length}>
              <p className="muted">
                JPEG, PNG, WebP or AVIF, up to 5 MB each. Photos are uploaded to your account and
                may be accessible before the recipe is published.
              </p>
              {(data.images || []).map((item, index) => (
                <div className="recipe-photo" key={`${item.image.ref.$link}-${index}`}>
                  <img
                    src={
                      photoPreviews[item.image.ref.$link] ||
                      `/api/images/${encodeURIComponent(item.image.ref.$link)}`
                    }
                    alt={item.alt}
                    loading="lazy"
                  />
                  <label>
                    Photo {index + 1} description
                    <textarea
                      name={`images.${index}.alt`}
                      rows={2}
                      placeholder="Describe the photo for someone who cannot see it."
                      value={item.alt}
                      onChange={(e) => photo(index, { alt: e.target.value })}
                    />
                  </label>
                  <Disclosure
                    title="Image dimensions"
                    populated={
                      !!(
                        editing.data.images?.[index]?.width || editing.data.images?.[index]?.height
                      )
                    }
                  >
                    <div className="recipe-fields-pair">
                      {(['width', 'height'] as const).map((key) => (
                        <label key={key}>
                          {key === 'width' ? 'Width' : 'Height'} (pixels)
                          <input
                            name={`images.${index}.${key}`}
                            type="number"
                            min={1}
                            max={100000}
                            step={1}
                            value={item[key] ?? ''}
                            onChange={(e) =>
                              photo(index, {
                                [key]: e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </Disclosure>
                  {rowActions(
                    'photo',
                    index,
                    data.images!.length,
                    (d) => update('images', move(data.images!, index, d)),
                    () =>
                      update(
                        'images',
                        data.images?.filter((_, i) => i !== index),
                      ),
                    0,
                  )}
                </div>
              ))}
              <label>
                Add photos
                <input
                  aria-label="Add photos"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  multiple
                  disabled={preview || (data.images?.length || 0) >= 8}
                  title={preview ? 'Photo uploads are unavailable in preview' : undefined}
                  onChange={(e) => {
                    void upload(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </Disclosure>
          </section>
          <section className="recipe-publish">
            <label className="network-consent">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                {editing.original
                  ? 'Make these changes public.'
                  : 'Publish this recipe publicly on my account.'}{' '}
                Anyone can read, share, and copy it.
              </span>
            </label>
          </section>
        </fieldset>
        <div ref={errorsRef} tabIndex={-1} className="recipe-validation">
          {issues.length > 0 && (
            <div role="alert">
              <p>Please check these details:</p>
              <ul>
                {issues.map((issue, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => revealIssue(issue.path)}
                    >
                      {recipeIssueLabel(issue.path)}: {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Notice error={error} />
        </div>
        <footer className="recipe-editor-footer">
          <span role="status" aria-live="polite" aria-atomic="true">
            {preview
              ? 'Preview only'
              : busy
                ? 'Saving…'
                : dirty
                  ? recoveryStatus || 'Unsaved changes'
                  : ''}
          </span>
          <div className="network-actions">
            <button
              type="button"
              className="button secondary"
              disabled={preview || busy || !!published}
              title={
                preview
                  ? 'Saving is unavailable in preview'
                  : busy
                    ? 'Please wait while we save.'
                    : 'Save a private draft only you can see'
              }
              onClick={() => void save(false)}
            >
              Save draft
            </button>
            <span
              className="disabled-hint"
              title={
                preview
                  ? 'Publishing is unavailable in preview'
                  : busy
                    ? 'Please wait while we save.'
                    : !confirmed
                      ? 'Check the publish box above to enable publishing.'
                      : editing.original
                        ? 'Publish your changes publicly'
                        : 'Publish this recipe publicly'
              }
            >
              <button
                type="submit"
                className="button primary"
                disabled={preview || busy || !confirmed}
                aria-describedby={!preview && !confirmed && !busy ? 'publish-hint' : undefined}
              >
                {published
                  ? 'Retry adding to meal plan'
                  : plannerTarget
                    ? 'Publish & add to meal plan'
                    : editing.original
                      ? 'Publish changes'
                      : 'Publish recipe'}
              </button>
            </span>
          </div>
          {!preview && !confirmed && !busy && (
            <span id="publish-hint" className="button-hint">
              Confirm public sharing to publish.
            </span>
          )}
        </footer>
      </form>
    </article>
  );
}
