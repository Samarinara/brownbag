import { useState } from 'react';
import { Modal, Notice } from '../../components';
import { message } from '../../errors';

export function TagDialog({
  existing,
  selected,
  saved,
  close,
  done,
}: {
  existing: string[];
  selected: string[];
  saved: boolean;
  close: () => void;
  done: (tags: string[]) => Promise<void>;
}) {
  const [choices, setChoices] = useState([...new Set([...existing, ...selected])]);
  const [selection, setSelection] = useState(selected);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const value = choices.find((tag) => tag.toLowerCase() === trimmed.toLowerCase()) || trimmed;
    setChoices((old) => [...new Set([...old, value])]);
    setSelection((old) => [...new Set([...old, value])]);
    setName('');
  };
  return (
    <Modal
      title={saved ? 'Recipe tags' : 'Save to cookbook'}
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const trimmed = name.trim();
            const value =
              choices.find((tag) => tag.toLowerCase() === trimmed.toLowerCase()) || trimmed;
            await done([...new Set([...selection, ...(value ? [value] : [])])]);
          } catch (e) {
            setError(message(e));
            setBusy(false);
          }
        }}
      >
        <fieldset className="network-tag-options" disabled={busy}>
          <legend>Choose tags</legend>
          <div className="network-tag-chits">
            {choices.map((tag) => (
              <button
                type="button"
                key={tag}
                aria-pressed={selection.includes(tag)}
                className={selection.includes(tag) ? 'active' : ''}
                onClick={() =>
                  setSelection((old) =>
                    old.includes(tag) ? old.filter((value) => value !== tag) : [...old, tag],
                  )
                }
              >
                {tag}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          New tag <span className="muted">(25 characters max)</span>
          <div className="network-new-tag">
            <input
              maxLength={25}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button
              type="button"
              className="button secondary"
              disabled={busy || !name.trim()}
              onClick={add}
            >
              Add
            </button>
          </div>
        </label>
        <Notice error={error} />
        <button className="button primary" disabled={busy}>
          {busy ? 'Saving…' : saved ? 'Done' : 'Save recipe'}
        </button>
      </form>
    </Modal>
  );
}
