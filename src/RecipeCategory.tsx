import { useId, useRef, useState } from 'react';

/** A margin annotation with suggestions shared by ingredient and step categories. */
export function RecipeCategory({
  name,
  label,
  value,
  categories,
  onChange,
}: {
  name: string;
  label: string;
  value?: string;
  categories: string[];
  onChange: (value: string | undefined) => void;
}) {
  const id = useId();
  const initiallyOpen = useRef(!!value);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const suggestions = categories.filter(
    (category) =>
      category !== value &&
      category.toLocaleLowerCase().includes((value || '').trim().toLocaleLowerCase()),
  );
  const expanded = focused && !dismissed && suggestions.length > 0;
  const selected = Math.min(active, Math.max(0, suggestions.length - 1));
  const accept = (category: string) => {
    onChange(category);
    setDismissed(true);
  };
  return (
    <details
      className="recipe-category"
      data-populated={value ? true : undefined}
      open={initiallyOpen.current || undefined}
    >
      <summary aria-label={`${label} selector`}>{value || '+ Category'}</summary>
      <div className="recipe-category-selector">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input
          id={id}
          name={name}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={`${id}-options`}
          aria-activedescendant={expanded ? `${id}-option-${selected}` : undefined}
          autoComplete="off"
          placeholder="Category"
          value={value || ''}
          onFocus={() => {
            setFocused(true);
            setDismissed(false);
          }}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            onChange(event.target.value || undefined);
            setActive(0);
            setDismissed(false);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              setDismissed(true);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setDismissed(false);
              setActive((current) =>
                suggestions.length
                  ? (current + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) %
                    suggestions.length
                  : 0,
              );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const exact = categories.find(
                (category) =>
                  category.toLocaleLowerCase() === (value || '').trim().toLocaleLowerCase(),
              );
              if (exact) accept(exact);
              else if (expanded) accept(suggestions[selected]);
              else onChange(value?.trim() || undefined);
            }
          }}
        />
        <ul
          id={`${id}-options`}
          role="listbox"
          aria-label={`${label} suggestions`}
          hidden={!expanded}
        >
          {suggestions.map((category, index) => (
            <li
              id={`${id}-option-${index}`}
              key={category}
              role="option"
              aria-selected={index === selected}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => accept(category)}
            >
              {category}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
