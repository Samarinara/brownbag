import { useState } from 'react';
import { BookOpen, Clock3, Users, ChevronDown } from 'lucide-react';
import type { RecipeInput, RecipeView } from '../shared/atproto';

export function recipeTime(record: RecipeInput) {
  const { prepMinutes, cookMinutes } = record;
  if (prepMinutes === undefined && cookMinutes === undefined) return null;
  return {
    label:
      prepMinutes !== undefined && cookMinutes !== undefined
        ? 'Total time'
        : prepMinutes !== undefined
          ? 'Prep time'
          : 'Cook time',
    minutes: (prepMinutes ?? 0) + (cookMinutes ?? 0),
  };
}

export const recipeYield = (record: RecipeInput) =>
  record.yield?.display?.trim() ||
  [record.yield?.quantity, record.yield?.unit].filter(Boolean).join(' ');

export function RecipeImage({ recipe }: { recipe: RecipeView }) {
  const photo = recipe.record.images?.[0];
  const src = photo
    ? `https://cdn.bsky.app/img/feed_fullsize/plain/${encodeURIComponent(recipe.authorDid)}/${encodeURIComponent(photo.image.ref.$link)}@jpeg`
    : '';
  const [failedSrc, setFailedSrc] = useState('');
  return (
    <div className="network-recipe-image">
      {src && failedSrc !== src ? (
        <img src={src} alt={photo!.alt} loading="lazy" onError={() => setFailedSrc(src)} />
      ) : (
        <div className="network-image-placeholder" aria-hidden="true">
          <BookOpen size={36} strokeWidth={1.2} />
          <span>From the community cookbook</span>
        </div>
      )}
    </div>
  );
}

export function RecipeTags({
  tags = [],
  limit = tags.length,
}: {
  tags?: string[];
  limit?: number;
}) {
  const unique = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  if (!unique.length) return null;
  return (
    <ul className="network-tags" aria-label="Recipe tags">
      {unique.slice(0, limit).map((tag) => (
        <li key={tag}>{tag}</li>
      ))}
      {unique.length > limit && (
        <li className="network-tags-more">+{unique.length - limit} more</li>
      )}
    </ul>
  );
}

export function CardFacts({ record }: { record: RecipeInput }) {
  const time = recipeTime(record);
  const yieldText = recipeYield(record);
  return (
    <div className="network-card-facts">
      {time && (
        <span>
          <Clock3 size={14} aria-hidden="true" />
          {time.minutes} min{' '}
          {time.label === 'Total time' ? 'total' : time.label === 'Prep time' ? 'prep' : 'cook'}
        </span>
      )}
      {yieldText && (
        <span>
          <Users size={14} aria-hidden="true" />
          <span>Yield: {yieldText}</span>
        </span>
      )}
      {!time && !yieldText && <span>{record.ingredients.length} ingredients</span>}
    </div>
  );
}

export function RecipeFacts({ record }: { record: RecipeInput }) {
  const time = recipeTime(record);
  const source = record.source;
  return (
    <dl className="network-recipe-facts">
      <div>
        <dt>{time?.label || 'Time'}</dt>
        <dd>{time ? `${time.minutes} min` : 'Not specified'}</dd>
        {record.prepMinutes !== undefined && record.cookMinutes !== undefined && (
          <dd className="network-fact-note">
            {record.prepMinutes} min prep · {record.cookMinutes} min cook
          </dd>
        )}
      </div>
      <div>
        <dt>Yield</dt>
        <dd>{recipeYield(record) || 'Not specified'}</dd>
      </div>
      <div>
        <dt>Source</dt>
        <dd>
          {source?.url && /^https?:\/\//i.test(source.url) ? (
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.name || source.url}
              <span className="network-fact-note"> ↗</span>
            </a>
          ) : (
            source?.name || 'Not specified'
          )}
        </dd>
      </div>
      <div className="network-fact-tags">
        <dt>Tags & dietary context</dt>
        <dd>{record.tags?.length ? <RecipeTags tags={record.tags} /> : 'No tags added'}</dd>
        <dd className="network-fact-note">As tagged by the cook</dd>
      </div>
    </dl>
  );
}

export function RecipeStory({ description }: { description?: string }) {
  if (!description?.trim()) return null;
  return (
    <details className="network-story">
      <summary>
        <span>
          <strong>Story & cooking notes</strong>
          <span className="network-story-hint">A little background and tips from the cook</span>
        </span>
        <ChevronDown size={19} aria-hidden="true" />
      </summary>
      <p className="network-prose">{description}</p>
    </details>
  );
}

// Keep ingredient order and original indices so checklist state survives section boundaries.
export function ingredientSections(ingredients: RecipeInput['ingredients']) {
  const sections: {
    name: string;
    items: { ingredient: RecipeInput['ingredients'][number]; index: number }[];
  }[] = [];
  ingredients.forEach((ingredient, index) => {
    const name = ingredient.group?.trim() || '';
    let section = sections.at(-1);
    if (!section || section.name !== name) {
      section = { name, items: [] };
      sections.push(section);
    }
    section.items.push({ ingredient, index });
  });
  return sections;
}
