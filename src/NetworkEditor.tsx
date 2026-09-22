import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { api, post } from './api';
import { Notice } from './components';
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

type Props = {
  route: string;
  userDid: string;
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
      if (url.pathname === '/recipe/new') return { data: blankRecipe() };
      if (url.pathname === '/recipe/draft') {
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
  }, [props.route, props.userDid]);
  if (!editing)
    return (
      <section className="network-editor-page">
        <button className="text-button" onClick={props.close}>
          <ArrowLeft size={16} /> Back to recipes
        </button>
        {error ? <Notice error={error} /> : <p role="status">Opening your recipe…</p>}
      </section>
    );
  return <NetworkEditor {...props} editing={editing} />;
}

function Disclosure({
  title,
  hint,
  populated,
  children,
}: {
  title: string;
  hint?: string;
  populated?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="recipe-disclosure" open={populated || undefined}>
      <summary>
        <span>{title}</span>
        {hint && <small>{hint}</small>}
      </summary>
      <div className="stack">{children}</div>
    </details>
  );
}

function NetworkEditor({ editing, close, done, leaveGuard }: Props & { editing: Editing }) {
  const [data, setData] = useState<RecipeInput>(() => editableRecipe(editing.data));
  const initial = useRef(JSON.stringify(data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [photoPreviews, setPhotoPreviews] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const errorsRef = useRef<HTMLDivElement>(null);
  const [issues, setIssues] = useState<{ path: PropertyKey[]; message: string }[]>([]);
  const dirty = JSON.stringify(data) !== initial.current;
  const update = <K extends keyof RecipeInput>(key: K, value: RecipeInput[K]) =>
    setData((old) => ({ ...old, [key]: value }));
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
  useEffect(() => {
    leaveGuard.current = () =>
      !busy && (!dirty || window.confirm('Leave this recipe? Unsaved changes will be lost.'));
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
  }, [dirty, busy, leaveGuard]);
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
    setError('');
    setIssues([]);
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
        result = editing.original
          ? await api<RecipeView>('/recipe', {
              method: 'PUT',
              body: JSON.stringify({
                uri: editing.original.uri,
                cid: editing.original.cid,
                recipe: checked.data,
              }),
            })
          : await post<RecipeView>('/recipes', { recipe: checked.data, draftId: editing.draftId });
      } else if (editing.draftId) {
        await api(`/drafts/${encodeURIComponent(editing.draftId)}`, {
          method: 'PUT',
          body: JSON.stringify({ data: checked.data }),
        });
      } else await post('/drafts', { data: checked.data });
      leaveGuard.current = () => true;
      done(result);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
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
        disabled={index === 0}
        onClick={() => reorder(-1)}
      >
        <ArrowUp size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={`Move ${label} ${index + 1} down`}
        disabled={index === length - 1}
        onClick={() => reorder(1)}
      >
        <ArrowDown size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={`Remove ${label} ${index + 1}`}
        disabled={length <= minimum}
        onClick={remove}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
  return (
    <article className="network-editor-page">
      <button className="text-button recipe-back" onClick={close}>
        <ArrowLeft size={16} /> Back to recipes
      </button>
      <header className="recipe-editor-heading">
        <p className="eyebrow">YOUR COOKBOOK</p>
        <h1>
          {editing.original
            ? 'A little refinement.'
            : editing.draftId
              ? 'Pick up where you left off.'
              : 'Something worth keeping.'}
        </h1>
        <p>Start with the essentials. Add the little details that make it yours.</p>
      </header>
      <form
        ref={formRef}
        className="network-editor"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmed && !busy) void save(true);
        }}
      >
        <fieldset disabled={busy} className="recipe-editor-fields">
          <section className="recipe-editor-section stack">
            <label>
              Recipe title
              <input
                name="title"
                value={data.title}
                onChange={(e) => update('title', e.target.value)}
                placeholder="Sunday’s slow-roasted tomatoes"
              />
            </label>
            <Disclosure
              title="A little introduction"
              hint="Optional"
              populated={!!editing.data.summary}
            >
              <label>
                What makes this recipe special?
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
              <span>{data.ingredients.length} / 64</span>
            </div>
            <p className="muted">
              A pinch, a handful, or an exact measure. Use what works for your recipe.
            </p>
            {data.ingredients.map((item, index) => (
              <div className="recipe-ingredient-row" key={index}>
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
                    <input
                      name={`ingredients.${index}.unit`}
                      aria-label={`Ingredient ${index + 1} unit`}
                      placeholder="cups"
                      value={item.unit || ''}
                      onChange={(e) => ingredient(index, { unit: e.target.value || undefined })}
                    />
                  </label>
                  <label className="recipe-ingredient-name">
                    Ingredient
                    <input
                      name={`ingredients.${index}.name`}
                      aria-label={`Ingredient ${index + 1} name`}
                      placeholder="Flour"
                      value={item.name}
                      onChange={(e) => ingredient(index, { name: e.target.value })}
                    />
                  </label>
                </div>
                <div className="recipe-row-bottom">
                  <Disclosure
                    title="Preparation & group"
                    populated={
                      !!(
                        editing.data.ingredients[index]?.preparation ||
                        editing.data.ingredients[index]?.group
                      )
                    }
                  >
                    <label>
                      Preparation
                      <input
                        name={`ingredients.${index}.preparation`}
                        placeholder="Sifted, finely chopped, at room temperature…"
                        value={item.preparation || ''}
                        onChange={(e) =>
                          ingredient(index, { preparation: e.target.value || undefined })
                        }
                      />
                    </label>
                    <label>
                      Ingredient group
                      <input
                        name={`ingredients.${index}.group`}
                        placeholder="For the dough"
                        value={item.group || ''}
                        onChange={(e) => ingredient(index, { group: e.target.value || undefined })}
                      />
                    </label>
                  </Disclosure>
                  {rowActions(
                    'ingredient',
                    index,
                    data.ingredients.length,
                    (d) => update('ingredients', move(data.ingredients, index, d)),
                    () =>
                      update(
                        'ingredients',
                        data.ingredients.filter((_, i) => i !== index),
                      ),
                  )}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              disabled={data.ingredients.length >= 64}
              onClick={() => update('ingredients', [...data.ingredients, { name: '' }])}
            >
              <Plus size={16} /> Add ingredient
            </button>
          </section>
          <section className="recipe-editor-section">
            <div className="recipe-section-heading">
              <h2>Method</h2>
              <span>{data.instructions.length} / 64</span>
            </div>
            {data.instructions.map((item, index) => (
              <div className="recipe-method-row" key={index}>
                <span className="recipe-step-number">{index + 1}</span>
                <div className="recipe-step-content">
                  <label>
                    Step {index + 1}
                    <textarea
                      name={`instructions.${index}.text`}
                      rows={3}
                      placeholder="What happens next?"
                      value={item.text}
                      onChange={(e) => step(index, { text: e.target.value })}
                    />
                  </label>
                  <div className="recipe-row-bottom">
                    <Disclosure
                      title="Step group"
                      populated={!!editing.data.instructions[index]?.group}
                    >
                      <label>
                        Group name
                        <input
                          name={`instructions.${index}.group`}
                          placeholder="Make the dough"
                          value={item.group || ''}
                          onChange={(e) => step(index, { group: e.target.value || undefined })}
                        />
                      </label>
                    </Disclosure>
                    {rowActions(
                      'step',
                      index,
                      data.instructions.length,
                      (d) => update('instructions', move(data.instructions, index, d)),
                      () =>
                        update(
                          'instructions',
                          data.instructions.filter((_, i) => i !== index),
                        ),
                    )}
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              disabled={data.instructions.length >= 64}
              onClick={() => update('instructions', [...data.instructions, { text: '' }])}
            >
              <Plus size={16} /> Add step
            </button>
          </section>
          <section className="recipe-editor-section recipe-extras">
            <h2>The little details</h2>
            <p className="muted">Everything here is optional.</p>
            <Disclosure
              title="Time & yield"
              hint="How long, how much"
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
                  placeholder="4–6 servings, one large loaf…"
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
            <Disclosure
              title="Story & cooking notes"
              hint="Make it personal"
              populated={!!editing.data.description}
            >
              <label>
                The story, serving suggestions, or a useful tip
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
              hint="Help others find it"
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
                      className="icon-button"
                      aria-label={`Remove tag ${index + 1}`}
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
                  placeholder="en, fr, es, zh-Hant…"
                  value={data.language || ''}
                  onChange={(e) => update('language', e.target.value || undefined)}
                />
                <small>Use a language code, such as en for English or fr for French.</small>
              </label>
            </Disclosure>
            <Disclosure
              title="Source & inspiration"
              hint="Give credit"
              populated={
                !!(editing.data.source || editing.data.derivedFrom || editing.data.adaptationNote)
              }
            >
              <label>
                Source name
                <input
                  name="source.name"
                  placeholder="A cookbook, a friend, a family tradition…"
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
              <Disclosure
                title="Credit a Brownbag recipe"
                hint="Original recipe reference"
                populated={!!editing.data.derivedFrom}
              >
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
                  disabled={(data.images?.length || 0) >= 8}
                  onChange={(e) => {
                    void upload(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </Disclosure>
          </section>
          <section className="recipe-publish">
            <h2>{editing.original ? 'Ready to update?' : 'Keep it, or share it.'}</h2>
            <p className="muted">
              {editing.original
                ? 'Publish your changes, or save a separate private draft.'
                : 'Save a private draft, or publish when you’re ready.'}
            </p>
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
          <span role="status">
            {busy ? 'Saving…' : dirty ? 'Unsaved changes' : 'Your recipe, your pace.'}
          </span>
          <div className="network-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void save(false)}
            >
              Save private draft
            </button>
            <button type="submit" className="button primary" disabled={busy || !confirmed}>
              {editing.original ? 'Publish changes' : 'Publish recipe'}
            </button>
          </div>
        </footer>
      </form>
    </article>
  );
}
