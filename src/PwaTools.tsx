import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { RecipeView } from '../shared/atproto';
import { RecipeFacts, ingredientSections } from './RecipePresentation';
import {
  clearDeviceData,
  offlineRecipe,
  offlineRecipes,
  removeOfflineRecipe,
  saveOfflineRecipe,
  type OfflineRecipe,
} from './offline-storage';
import './pwa.css';

type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function OfflineRecipeButton({ recipe }: { recipe: RecipeView }) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void offlineRecipe(recipe.uri)
        .then((item) => {
          if (alive) setSaved(!!item);
        })
        .catch(() => {});
    refresh();
    window.addEventListener('brownbag-offline-changed', refresh);
    const cleared = () => setSaved(false);
    window.addEventListener('brownbag-device-data-cleared', cleared);
    return () => {
      alive = false;
      window.removeEventListener('brownbag-device-data-cleared', cleared);
      window.removeEventListener('brownbag-offline-changed', refresh);
    };
  }, [recipe.uri]);
  return (
    <span className="offline-save">
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            if (saved) await removeOfflineRecipe(recipe.uri);
            else await saveOfflineRecipe(recipe);
            setSaved(!saved);
          } catch {
            setError('Device storage is unavailable or full.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {saved ? 'Remove offline copy' : 'Keep recipe offline'}
      </button>
      {error && <small role="alert">{error}</small>}
    </span>
  );
}

export function PwaTools({ canReload }: { canReload: () => boolean }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallEvent>();
  const [standalone, setStandalone] = useState(
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      !!(navigator as Navigator & { standalone?: boolean }).standalone,
  );
  const [help, setHelp] = useState(false);
  const [library, setLibrary] = useState(false);
  const [items, setItems] = useState<OfflineRecipe[]>([]);
  const [selected, setSelected] = useState<OfflineRecipe>();
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: () => setError('Offline setup failed. Reload when connected to try again.'),
  });
  useEffect(() => {
    const connected = () => setOnline(navigator.onLine);
    const available = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    const installed = () => {
      setInstall(undefined);
      setStandalone(true);
      setHelp(false);
    };
    window.addEventListener('online', connected);
    window.addEventListener('offline', connected);
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', connected);
      window.removeEventListener('beforeinstallprompt', available);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  const openLibrary = async () => {
    setError('');
    setSelected(undefined);
    try {
      setItems(
        (await offlineRecipes()).sort((a, b) =>
          a.recipe.record.title.localeCompare(b.recipe.record.title),
        ),
      );
    } catch {
      setError('Device storage is unavailable.');
      setItems([]);
    }
    setLibrary(true);
    dialog.current?.showModal();
  };
  useEffect(() => {
    if (!navigator.onLine) void openLibrary();
  }, []);
  const closeLibrary = () => {
    dialog.current?.close();
    setLibrary(false);
    setSelected(undefined);
  };
  return (
    <>
      <aside className="pwa-tools" aria-label="App and offline options">
        {!online && <span role="status">You’re offline. Open a recipe kept on this device.</span>}
        <button className="text-button" onClick={() => void openLibrary()}>
          Offline recipes
        </button>
        {!standalone && (
          <button
            className="text-button"
            onClick={async () => {
              if (!install) {
                setHelp(!help);
                return;
              }
              try {
                await install.prompt();
                await install.userChoice;
                setInstall(undefined);
              } catch {
                setHelp(true);
              }
            }}
          >
            Install app
          </button>
        )}
        {help && (
          <p>
            On iPhone or iPad, open Brownbag in Safari, tap Share, then Add to Home Screen. On
            Android, use your browser’s Install app or Add to Home screen menu.
          </p>
        )}
        {needRefresh && (
          <div className="pwa-update" role="status">
            <span>
              A new version is ready. Save your work in other Brownbag tabs before updating.
            </span>
            <button
              className="button secondary"
              onClick={() => {
                if (canReload())
                  void updateServiceWorker(true).catch(() =>
                    setError('Could not update. Please reload when connected.'),
                  );
              }}
            >
              Update now
            </button>
            <button className="text-button" onClick={() => setNeedRefresh(false)}>
              Later
            </button>
          </div>
        )}
        {error && !library && <p role="alert">{error}</p>}
      </aside>
      <dialog
        className="offline-library"
        ref={dialog}
        onClose={() => {
          setLibrary(false);
          setSelected(undefined);
        }}
        aria-labelledby="offline-title"
      >
        <div className="offline-toolbar">
          <h2 id="offline-title">{selected ? selected.recipe.record.title : 'Offline recipes'}</h2>
          <button className="button secondary" onClick={closeLibrary}>
            Close
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {selected ? (
          <article>
            <button className="text-button" onClick={() => setSelected(undefined)}>
              Back to offline recipes
            </button>
            <p>
              By {selected.recipe.authorHandle || selected.recipe.authorDid} · Saved{' '}
              {new Date(selected.savedAt).toLocaleDateString()}
            </p>
            <p>Offline text copy. Photos and updates require a connection.</p>
            <RecipeFacts record={selected.recipe.record} />
            {selected.recipe.record.description && (
              <p className="offline-story">{selected.recipe.record.description}</p>
            )}
            <h3>Ingredients</h3>
            {ingredientSections(selected.recipe.record.ingredients).map((section, i) => (
              <section key={i}>
                {section.name && <h4>{section.name}</h4>}
                <ul>
                  {section.items.map(({ ingredient: item }, j) => (
                    <li key={j}>
                      {[item.quantity, item.unit, item.name, item.preparation]
                        .filter(Boolean)
                        .join(' ')}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <h3>Method</h3>
            <ol>
              {selected.recipe.record.instructions.map((step, i) => (
                <li key={i}>
                  {step.group && <strong>{step.group}: </strong>}
                  {step.text}
                </li>
              ))}
            </ol>
            {selected.recipe.record.source?.url && (
              <p>
                <a href={selected.recipe.record.source?.url} target="_blank" rel="noreferrer">
                  Original source
                </a>
              </p>
            )}
          </article>
        ) : (
          <>
            <p>
              Keep a recipe offline from its recipe page. Text copies stay on this device until
              removed, signed out, or cleared by your browser.
            </p>
            {!items.length && <p>No offline recipes yet.</p>}
            <ul className="offline-list">
              {items.map((item) => (
                <li key={item.recipe.uri}>
                  <button className="text-button" onClick={() => setSelected(item)}>
                    {item.recipe.record.title}
                  </button>
                  <button
                    className="text-button"
                    aria-label={`Remove ${item.recipe.record.title} from this device`}
                    onClick={async () => {
                      try {
                        await removeOfflineRecipe(item.recipe.uri);
                        setItems((old) =>
                          old.filter((entry) => entry.recipe.uri !== item.recipe.uri),
                        );
                      } catch {
                        setError('Could not remove this copy.');
                      }
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="button secondary"
              onClick={async () => {
                if (
                  !window.confirm(
                    'Remove all offline recipes and recovered drafts from this device?',
                  )
                )
                  return;
                try {
                  await clearDeviceData();
                  setItems([]);
                } catch {
                  setError('Some device storage could not be cleared.');
                }
              }}
            >
              Clear device data
            </button>
          </>
        )}
      </dialog>
    </>
  );
}
