import { useState } from 'react';
import { Globe2 } from 'lucide-react';
import { api, post } from './api';
import { Modal, Notice } from './components';
import { recipeInputSchema, type RecipeInput, type RecipeView } from '../shared/atproto';
import { message, type Editing } from './NetworkApp';

export function NetworkEditor({
  editing,
  close,
  done,
}: {
  editing: Editing;
  close: () => void;
  done: (recipe?: RecipeView) => void;
}) {
  const [data, setData] = useState<RecipeInput>(() => {
    const {
      $type: _type,
      createdAt: _created,
      updatedAt: _updated,
      ...input
    } = editing.data as RecipeInput & { $type?: string; createdAt?: string; updatedAt?: string };
    return input;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [tags, setTags] = useState((editing.data.tags || []).join(', '));
  const update = <K extends keyof RecipeInput>(key: K, value: RecipeInput[K]) =>
    setData((old) => ({ ...old, [key]: value }));
  const save = async (publish: boolean) => {
    setError('');
    setBusy(true);
    try {
      const input = {
        ...data,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      if (publish) {
        const checked = recipeInputSchema.safeParse(input);
        if (!checked.success)
          throw new Error(
            checked.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('; '),
          );
        const result = editing.original
          ? await api<RecipeView>('/recipe', {
              method: 'PUT',
              body: JSON.stringify({
                uri: editing.original.uri,
                cid: editing.original.cid,
                recipe: checked.data,
              }),
            })
          : await post<RecipeView>('/recipes', { recipe: checked.data, draftId: editing.draftId });
        done(result);
      } else {
        if (editing.draftId)
          await api(`/drafts/${encodeURIComponent(editing.draftId)}`, {
            method: 'PUT',
            body: JSON.stringify({ data: input }),
          });
        else await post('/drafts', { data: input });
        done();
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={editing.original ? 'Edit your recipe' : 'Something worth sharing'}
      close={() => {
        if (!busy && window.confirm('Close this editor? Unsaved changes will be lost.')) close();
      }}
      wide
    >
      <form
        className="stack network-editor"
        onSubmit={(e) => {
          e.preventDefault();
          if (confirmed) void save(true);
        }}
      >
        <label>
          Recipe title
          <input
            value={data.title}
            onChange={(e) => update('title', e.target.value)}
            placeholder="Sunday’s slow-roasted tomatoes"
            maxLength={300}
          />
        </label>
        <label>
          A little introduction
          <textarea
            rows={2}
            value={data.summary || ''}
            onChange={(e) => update('summary', e.target.value)}
            placeholder="What makes this one special?"
          />
        </label>
        <div className="network-editor-times">
          <label>
            Prep time (minutes)
            <input
              type="number"
              min={0}
              step={1}
              value={data.prepMinutes ?? ''}
              onChange={(e) =>
                update('prepMinutes', e.target.value === '' ? undefined : Number(e.target.value))
              }
            />
          </label>
          <label>
            Cook time (minutes)
            <input
              type="number"
              min={0}
              step={1}
              value={data.cookMinutes ?? ''}
              onChange={(e) =>
                update('cookMinutes', e.target.value === '' ? undefined : Number(e.target.value))
              }
            />
          </label>
          <label>
            Makes
            <input
              value={data.yield?.display || ''}
              onChange={(e) => update('yield', { ...data.yield, display: e.target.value })}
              placeholder="4 servings"
            />
          </label>
        </div>
        <fieldset>
          <legend>Ingredients</legend>
          {data.ingredients.map((ingredient, index) => (
            <div className="network-ingredient-editor" key={index}>
              <input
                aria-label={`Ingredient ${index + 1} quantity`}
                value={ingredient.quantity || ''}
                placeholder="1 ½"
                onChange={(e) =>
                  update(
                    'ingredients',
                    data.ingredients.map((item, i) =>
                      i === index ? { ...item, quantity: e.target.value } : item,
                    ),
                  )
                }
              />
              <input
                aria-label={`Ingredient ${index + 1} unit`}
                value={ingredient.unit || ''}
                placeholder="cups"
                onChange={(e) =>
                  update(
                    'ingredients',
                    data.ingredients.map((item, i) =>
                      i === index ? { ...item, unit: e.target.value } : item,
                    ),
                  )
                }
              />
              <input
                aria-label={`Ingredient ${index + 1} name`}
                value={ingredient.name}
                placeholder="Ingredient"
                onChange={(e) =>
                  update(
                    'ingredients',
                    data.ingredients.map((item, i) =>
                      i === index ? { ...item, name: e.target.value } : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ingredient ${index + 1}`}
                disabled={data.ingredients.length === 1}
                onClick={() =>
                  update(
                    'ingredients',
                    data.ingredients.filter((_, i) => i !== index),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() => update('ingredients', [...data.ingredients, { name: '' }])}
          >
            Add ingredient
          </button>
        </fieldset>
        <fieldset>
          <legend>Method</legend>
          {data.instructions.map((instruction, index) => (
            <div className="network-step-editor" key={index}>
              <label>
                Step {index + 1}
                <textarea
                  rows={2}
                  value={instruction.text}
                  onChange={(e) =>
                    update(
                      'instructions',
                      data.instructions.map((item, i) =>
                        i === index ? { ...item, text: e.target.value } : item,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove step ${index + 1}`}
                disabled={data.instructions.length === 1}
                onClick={() =>
                  update(
                    'instructions',
                    data.instructions.filter((_, i) => i !== index),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() => update('instructions', [...data.instructions, { text: '' }])}
          >
            Add step
          </button>
        </fieldset>
        <label>
          Tags, separated by commas
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="weeknight, vegetarian"
          />
        </label>
        <label>
          Story and cooking notes
          <textarea
            value={data.description || ''}
            onChange={(e) => update('description', e.target.value)}
            rows={3}
          />
        </label>
        {data.derivedFrom && (
          <label>
            What did you change?
            <textarea
              value={data.adaptationNote || ''}
              onChange={(e) => update('adaptationNote', e.target.value)}
              rows={2}
            />
            <small>The original recipe will be credited automatically.</small>
          </label>
        )}
        <label>
          Original source URL (optional)
          <input
            type="url"
            value={data.source?.url || ''}
            onChange={(e) =>
              update('source', e.target.value ? { ...data.source, url: e.target.value } : undefined)
            }
            placeholder="https://…"
          />
        </label>
        <label className="network-consent">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            <Globe2 size={15} />{' '}
            {editing.original
              ? 'These changes will be public.'
              : 'Publish this recipe publicly on my account.'}{' '}
            Anyone can read, share, and copy it.
          </span>
        </label>
        <Notice error={error} />
        <div className="network-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              void save(false);
            }}
          >
            Save private draft
          </button>
          <button type="submit" className="button primary" disabled={busy || !confirmed}>
            {busy ? 'Saving…' : editing.original ? 'Publish changes' : 'Publish recipe'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
