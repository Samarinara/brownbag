import { createId } from './id';
import { flushSync } from 'react-dom';
import { Disclosure as PolliDisclosure, Skeleton } from './ui';
import { Button, Input, Textarea, Label, Checkbox } from './ui';
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
import { blobImageUrl, api, post } from './api';
import { Notice } from './components';
import { RecipeCategory } from './RecipeCategory';
import { mealLabels, retentionStart, targetFromRoute } from '../shared/planner';
import { displayDate } from './features/planner/navigation';
import {
  draftInputSchema,
  recipeInputSchema,
  type RecipeInput,
  type RecipeView,
} from '../shared/atproto';
import { message } from './errors';
import {
  adaptRecipe,
  type Editing,
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
      <Input
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
  const [loadRevision, setLoadRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setError('');
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
  }, [props.route, props.userDid, props.preview, loadRevision]);
  if (!editing)
    return (
      <section className="network-editor-page">
        <Button className="text-button" onClick={props.close}>
          <ArrowLeft size={16} /> Back to recipes
        </Button>
        {error ? (
          <>
            <h1>Recipe unavailable</h1>
            <Notice error={error} />
            <Button className="text-button" onClick={() => setLoadRevision((value) => value + 1)}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <p className="sr-only" role="status">
              Opening your recipe…
            </p>
            <div aria-hidden="true">
              <Skeleton className="skeleton skeleton-line short" />
              <Skeleton className="skeleton skeleton-line hero" />
              <Skeleton className="skeleton skeleton-line" />
              <Skeleton className="skeleton skeleton-line narrow" />
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
    <PolliDisclosure
      className="recipe-disclosure"
      defaultOpen={!!populated}
      label={label}
      title={
        <>
          <span>{title}</span>
          {hint && <small>{hint}</small>}
        </>
      }
    >
      <div className="stack">{children}</div>
    </PolliDisclosure>
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
  const plannedId = useRef(createId());
  const [published, setPublished] = useState<RecipeView>();
  const [data, setData] = useState<RecipeInput>(() => editableRecipe(editing.data));
  const rowKeys = useRef({
    ingredients: data.ingredients.map(() => createId()),
    instructions: data.instructions.map(() => createId()),
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
  const [importUrl, setImportUrl] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const importing = useRef(false);
  const [importRevision, setImportRevision] = useState(0);
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
    rowKeys.current[kind].push(createId());
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
    focusRow(kind, index + direction);
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
    focusRow(kind, Math.min(index, data[kind].length - 2));
  };
  const focusRow = (kind: 'ingredients' | 'instructions', index: number) => {
    requestAnimationFrame(() => {
      formRef.current
        ?.querySelector<HTMLElement>(
          `[name="${kind}.${index}.${kind === 'ingredients' ? 'name' : 'text'}"]`,
        )
        ?.focus();
    });
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
        if (parent.matches('[data-polli="accordion-item"][data-state="closed"]')) {
          const trigger = parent.querySelector<HTMLButtonElement>(
            '[data-polli="accordion-trigger"]',
          );
          flushSync(() => trigger?.click());
        }
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
            id: createId(),
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
            id: createId(),
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
  const importLink = async (url: string) => {
    if (preview || busy || importing.current || recovery || publicationIntent.current) return;
    if (dirty && !window.confirm('Replace the current recipe fields with the linked recipe?'))
      return;
    importing.current = true;
    setBusy(true);
    setError('');
    setIssues([]);
    setImportStatus('Reading the recipe…');
    try {
      const { recipe } = await post<{ recipe: RecipeInput }>('/recipes/import', { url });
      const imported = recipeInputSchema.parse(recipe);
      rowKeys.current = {
        ingredients: imported.ingredients.map(() => createId()),
        instructions: imported.instructions.map(() => createId()),
      };
      setData(editableRecipe(imported));
      setImportRevision((revision) => revision + 1);
      setConfirmed(false);
      setImportStatus('Recipe imported. Review the details, then publish when you’re ready.');
    } catch (error) {
      setImportStatus('');
      setError(message(error));
    } finally {
      importing.current = false;
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
      <Button
        type="button"
        className="icon-button"
        aria-label={`Move ${label} ${index + 1} up`}
        title={`Move ${label} ${index + 1} up`}
        disabled={index === 0}
        onClick={() => reorder(-1)}
      >
        <ArrowUp size={15} />
      </Button>
      <Button
        type="button"
        className="icon-button danger"
        aria-label={`Remove ${label} ${index + 1}`}
        title={`Remove ${label} ${index + 1}`}
        disabled={length <= minimum}
        onClick={remove}
      >
        <Trash2 size={15} />
      </Button>
      <Button
        type="button"
        className="icon-button"
        aria-label={`Move ${label} ${index + 1} down`}
        title={`Move ${label} ${index + 1} down`}
        disabled={index === length - 1}
        onClick={() => reorder(1)}
      >
        <ArrowDown size={15} />
      </Button>
    </div>
  );
  return (
    <article className="network-editor-page">
      <Button className="text-button recipe-back" onClick={close}>
        <ArrowLeft size={16} /> {plannerTarget ? 'Back to Meal Planner' : 'Back to recipes'}
      </Button>
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
      {importStatus && <p role="status">{importStatus}</p>}
      {recovery && (
        <div className="recovery-notice" role="status">
          <p>There are unsaved changes from an earlier visit on this device.</p>
          <Button
            className="button secondary"
            onClick={() => {
              rowKeys.current = {
                ingredients: recovery.ingredients.map(() => createId()),
                instructions: recovery.instructions.map(() => createId()),
              };
              setData(editableRecipe(recovery));
              setRecovery(undefined);
            }}
          >
            Restore changes
          </Button>{' '}
          <Button
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
          </Button>
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
        <fieldset
          key={importRevision}
          disabled={busy || !!published}
          className="recipe-editor-fields"
        >
          {!editing.original && !editing.draftId && (
            <section className="recipe-editor-section stack">
              <h2>Start with a recipe link</h2>
              <p>Paste a link to fill in your recipe and credit the source.</p>
              <Label>
                Recipe website link
                <Input
                  type="url"
                  value={importUrl}
                  placeholder="https://example.com/your-favourite-recipe"
                  disabled={preview || !!publicationIntent.current}
                  onChange={(event) => setImportUrl(event.target.value)}
                  onPaste={(event) => {
                    const url = event.clipboardData.getData('text').trim();
                    event.preventDefault();
                    setImportUrl(url);
                    void importLink(url);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void importLink(importUrl);
                    }
                  }}
                />
              </Label>
              <Button
                type="button"
                className="button secondary"
                disabled={preview || !importUrl.trim() || !!publicationIntent.current}
                onClick={() => void importLink(importUrl)}
              >
                Import recipe
              </Button>
            </section>
          )}
          <section className="recipe-editor-section stack">
            <h2 className="sr-only">Recipe introduction</h2>
            <Label>
              Recipe title
              <Input
                name="title"
                value={data.title}
                onChange={(e) => update('title', e.target.value)}
                placeholder="Lemon pasta"
              />
            </Label>
            <Disclosure title="Introduction" populated={!!data.summary}>
              <Label>
                Short description
                <Textarea
                  name="summary"
                  rows={2}
                  value={data.summary || ''}
                  onChange={(e) => update('summary', e.target.value || undefined)}
                />
              </Label>
            </Disclosure>
          </section>
          <section className="recipe-editor-section">
            <div className="recipe-section-heading">
              <h2>Ingredients</h2>
            </div>
            {data.ingredients.map((item, index) => (
              <div className="recipe-ingredient-row" key={rowKeys.current.ingredients[index]}>
                <div className="recipe-ingredient-fields">
                  <Label>
                    <span>Quantity</span>
                    <Input
                      name={`ingredients.${index}.quantity`}
                      aria-label={`Ingredient ${index + 1} quantity`}
                      placeholder="1 ½"
                      value={item.quantity || ''}
                      onChange={(e) => ingredient(index, { quantity: e.target.value || undefined })}
                    />
                  </Label>
                  <Label>
                    Unit
                    <IngredientTextInput
                      kind="unit"
                      name={`ingredients.${index}.unit`}
                      aria-label={`Ingredient ${index + 1} unit`}
                      placeholder="cups"
                      value={item.unit || ''}
                      onChange={(e) => ingredient(index, { unit: e.target.value || undefined })}
                    />
                  </Label>
                  <Label className="recipe-ingredient-name">
                    Ingredient
                    <IngredientTextInput
                      kind="ingredient"
                      name={`ingredients.${index}.name`}
                      aria-label={`Ingredient ${index + 1} name`}
                      placeholder="Flour"
                      value={item.name}
                      onChange={(e) => ingredient(index, { name: e.target.value })}
                    />
                  </Label>
                </div>
                <Disclosure
                  title="Preparation"
                  label={`Ingredient ${index + 1} preparation options`}
                  populated={!!data.ingredients[index]?.preparation}
                >
                  <Label>
                    <span className="sr-only">Ingredient {index + 1} preparation</span>
                    <Input
                      name={`ingredients.${index}.preparation`}
                      placeholder="Finely chopped"
                      value={item.preparation || ''}
                      onChange={(e) =>
                        ingredient(index, { preparation: e.target.value || undefined })
                      }
                    />
                  </Label>
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
            <Button
              type="button"
              className="text-button"
              disabled={data.ingredients.length >= 64}
              onClick={() => addRow('ingredients')}
            >
              <Plus size={16} /> Add ingredient
            </Button>
          </section>
          <section className="recipe-editor-section">
            <div className="recipe-section-heading">
              <h2>Steps</h2>
            </div>
            {data.instructions.map((item, index) => (
              <div className="recipe-method-row" key={rowKeys.current.instructions[index]}>
                <span className="recipe-step-number">{index + 1}</span>
                <div className="recipe-step-content">
                  <Label htmlFor={`recipe-step-${rowKeys.current.instructions[index]}`}>
                    Step {index + 1}
                  </Label>
                  <Textarea
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
            <Button
              type="button"
              className="text-button"
              disabled={data.instructions.length >= 64}
              onClick={() => addRow('instructions')}
            >
              <Plus size={16} /> Add step
            </Button>
          </section>
          <section className="recipe-editor-section recipe-extras">
            <h2>Details</h2>
            <Disclosure
              title="Time & servings"
              populated={
                !!(data.yield || data.prepMinutes !== undefined || data.cookMinutes !== undefined)
              }
            >
              <div className="recipe-fields-pair">
                {(['prepMinutes', 'cookMinutes'] as const).map((key) => (
                  <Label key={key}>
                    {key === 'prepMinutes' ? 'Prep time (minutes)' : 'Cook time (minutes)'}
                    <Input
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
                  </Label>
                ))}
              </div>
              <Label>
                Makes
                <Input
                  name="yield.display"
                  placeholder="4 servings"
                  value={data.yield?.display || ''}
                  onChange={(e) =>
                    update('yield', { ...data.yield, display: e.target.value || undefined })
                  }
                />
              </Label>
              <Disclosure
                title="Separate quantity & unit"
                populated={!!(data.yield?.quantity || data.yield?.unit)}
              >
                <div className="recipe-fields-pair">
                  <Label>
                    Yield quantity
                    <Input
                      name="yield.quantity"
                      placeholder="12"
                      value={data.yield?.quantity || ''}
                      onChange={(e) =>
                        update('yield', { ...data.yield, quantity: e.target.value || undefined })
                      }
                    />
                  </Label>
                  <Label>
                    Yield unit
                    <Input
                      name="yield.unit"
                      placeholder="cookies"
                      value={data.yield?.unit || ''}
                      onChange={(e) =>
                        update('yield', { ...data.yield, unit: e.target.value || undefined })
                      }
                    />
                  </Label>
                </div>
              </Disclosure>
            </Disclosure>
            <Disclosure title="Notes" populated={!!data.description}>
              <Label>
                Cooking notes
                <Textarea
                  name="description"
                  rows={6}
                  value={data.description || ''}
                  onChange={(e) => update('description', e.target.value || undefined)}
                />
              </Label>
            </Disclosure>
            <Disclosure title="Tags & language" populated={!!(data.tags?.length || data.language)}>
              <div className="stack">
                {(data.tags || []).map((tag, index) => (
                  <div className="recipe-tag-row" key={index}>
                    <Label>
                      Tag {index + 1}
                      <Input
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
                    </Label>
                    <Button
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
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  className="text-button"
                  disabled={(data.tags?.length || 0) >= 30}
                  onClick={() => update('tags', [...(data.tags || []), ''])}
                >
                  <Plus size={16} /> Add tag
                </Button>
              </div>
              <Label>
                Recipe language
                <Input
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
              </Label>
            </Disclosure>
            <Disclosure
              title="Source & inspiration"
              populated={!!(data.source || data.derivedFrom || data.adaptationNote)}
            >
              <Label>
                Source name
                <Input
                  name="source.name"
                  placeholder="Family cookbook"
                  value={data.source?.name || ''}
                  onChange={(e) =>
                    update('source', { ...data.source, name: e.target.value || undefined })
                  }
                />
              </Label>
              <Label>
                Source link
                <Input
                  name="source.url"
                  type="url"
                  placeholder="https://…"
                  value={data.source?.url || ''}
                  onChange={(e) =>
                    update('source', { ...data.source, url: e.target.value || undefined })
                  }
                />
              </Label>
              <Label>
                What did you change?
                <Textarea
                  name="adaptationNote"
                  rows={2}
                  value={data.adaptationNote || ''}
                  onChange={(e) => update('adaptationNote', e.target.value || undefined)}
                />
              </Label>
              <Disclosure title="Credit a Brownbag recipe" populated={!!data.derivedFrom}>
                <p className="muted">
                  “Make it your own” fills this in for you. You can also enter a recipe’s record
                  address and version.
                </p>
                <Label>
                  Original recipe address
                  <Input
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
                </Label>
                <Label>
                  Original version (CID)
                  <Input
                    name="derivedFrom.cid"
                    value={data.derivedFrom?.cid || ''}
                    onChange={(e) =>
                      update('derivedFrom', {
                        uri: data.derivedFrom?.uri || '',
                        cid: e.target.value,
                      })
                    }
                  />
                </Label>
                {data.derivedFrom && (
                  <Button
                    type="button"
                    className="text-button"
                    onClick={() => update('derivedFrom', undefined)}
                  >
                    Remove original recipe credit
                  </Button>
                )}
              </Disclosure>
            </Disclosure>
            <Disclosure title="Photos" hint="Up to 8" populated={!!data.images?.length}>
              <p className="muted">
                JPEG, PNG, WebP or AVIF, up to 5 MB each. Photos are uploaded to your account and
                may be accessible before the recipe is published.
              </p>
              {(data.images || []).map((item, index) => (
                <div className="recipe-photo" key={`${item.image.ref.$link}-${index}`}>
                  <img
                    src={photoPreviews[item.image.ref.$link] || blobImageUrl(item.image.ref.$link)}
                    alt={item.alt}
                    loading="lazy"
                  />
                  <Label>
                    Photo {index + 1} description
                    <Textarea
                      name={`images.${index}.alt`}
                      rows={2}
                      placeholder="Describe the photo for someone who cannot see it."
                      value={item.alt}
                      onChange={(e) => photo(index, { alt: e.target.value })}
                    />
                  </Label>
                  <Disclosure
                    title="Image dimensions"
                    populated={!!(data.images?.[index]?.width || data.images?.[index]?.height)}
                  >
                    <div className="recipe-fields-pair">
                      {(['width', 'height'] as const).map((key) => (
                        <Label key={key}>
                          {key === 'width' ? 'Width' : 'Height'} (pixels)
                          <Input
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
                        </Label>
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
              <Label>
                Add photos
                <Input
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
              </Label>
            </Disclosure>
          </section>
          <section className="recipe-publish">
            <Label className="network-consent">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(checked) => setConfirmed(checked === true)}
              />
              <span>
                {editing.original
                  ? 'Make these changes public.'
                  : 'Publish this recipe publicly on my account.'}{' '}
                Anyone can read, share, and copy it.
              </span>
            </Label>
          </section>
        </fieldset>
        <div ref={errorsRef} tabIndex={-1} className="recipe-validation">
          {issues.length > 0 && (
            <div role="alert">
              <p>Please check these details:</p>
              <ul>
                {issues.map((issue, i) => (
                  <li key={i}>
                    <Button
                      type="button"
                      className="text-button"
                      onClick={() => revealIssue(issue.path)}
                    >
                      {recipeIssueLabel(issue.path)}: {issue.message}
                    </Button>
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
            <Button
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
            </Button>
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
              <Button
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
              </Button>
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
