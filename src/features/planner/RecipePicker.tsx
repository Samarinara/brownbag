import {
  Button,
  Input,
  Label,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  ListRow,
  EmptyState,
} from '../../ui';
import { retryMessage as errorMessage } from '../../errors';
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, post } from '../../api';
import { Modal, Notice } from '../../components';
import { recipeTime } from '../../RecipePresentation';
import type { RecipeView } from '../../../shared/atproto';
import { mealLabels, type MealTarget } from '../../../shared/planner';
import { displayDate } from './navigation';

export function RecipePicker({
  target,
  close,
  added,
  create,
}: {
  target: MealTarget;
  close: () => void;
  added: () => void;
  create: () => void;
}) {
  const [feed, setFeed] = useState<'cookbook' | 'discover'>('cookbook');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [recipes, setRecipes] = useState<RecipeView[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef(0);
  const pending = useRef<{ uri: string; id: string } | undefined>(undefined);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 220);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const current = ++request.current;
    setLoading(true);
    setError('');
    setRecipes([]);
    setCursor(undefined);
    api<{ recipes: RecipeView[]; nextCursor?: string }>(
      `/recipes?${new URLSearchParams({ feed, q: search, limit: '24' })}`,
    )
      .then((result) => {
        if (current === request.current) {
          setRecipes(result.recipes);
          setCursor(result.nextCursor);
        }
      })
      .catch((error) => {
        if (current === request.current) setError(errorMessage(error));
      })
      .finally(() => {
        if (current === request.current) setLoading(false);
      });
    return () => {
      request.current++;
    };
  }, [feed, search]);
  async function add(recipe: RecipeView) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    if (pending.current?.uri !== recipe.uri)
      pending.current = { uri: recipe.uri, id: crypto.randomUUID() };
    try {
      await post('/planner', { ...target, uri: recipe.uri, id: pending.current.id });
      pending.current = undefined;
      added();
      setNotice(
        `Added ${recipe.record.title} to ${mealLabels[target.slot]}. Add another or choose Done.`,
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Choose recipes"
      wide
      close={() => {
        if (!busy) close();
      }}
    >
      <Tabs value={feed} onValueChange={(value) => setFeed(value as typeof feed)}>
        <p className="muted">
          {displayDate(target.date)} · {mealLabels[target.slot]}
        </p>
        <div className="planner-picker-toolbar">
          <TabsList className="planner-toggle" aria-label="Recipe collection">
            {(['cookbook', 'discover'] as const).map((value) => (
              <TabsTrigger value={value} key={value} disabled={busy}>
                {value === 'cookbook' ? 'Cookbook' : 'Discover'}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button className="button secondary" disabled={busy} onClick={create}>
            <Plus size={16} /> Create new recipe
          </Button>
        </div>
        <Label className="planner-search">
          Search recipes
          <Input
            type="search"
            placeholder="Search by title or ingredient…"
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Label>
        <Notice error={error} />
        <p role="status" className="planner-picker-notice">
          {notice || (loading ? 'Loading recipes…' : '')}
        </p>
        <TabsContent value={feed} asChild>
          <div className="planner-picker-results" aria-busy={loading}>
            {!loading && !recipes.length && (
              <EmptyState
                title="No recipes found"
                description="Try Discover, another search, or create a recipe."
              />
            )}
            {recipes.map((recipe) => {
              const time = recipeTime(recipe.record);
              return (
                <ListRow
                  className="planner-picker-recipe"
                  key={recipe.uri}
                  title={<strong>{recipe.record.title}</strong>}
                  description={
                    <small>
                      {recipe.authorHandle ? `@${recipe.authorHandle}` : 'Community cook'}
                      {time ? ` · ${time.minutes} min` : ''}
                    </small>
                  }
                  trailing={
                    <Button
                      className="button secondary"
                      disabled={busy || loading}
                      aria-label={`Add ${recipe.record.title}`}
                      onClick={() => void add(recipe)}
                    >
                      <Plus size={16} /> Add
                    </Button>
                  }
                />
              );
            })}
            {cursor && (
              <Button
                className="button secondary"
                disabled={busy || loading}
                onClick={async () => {
                  const current = request.current;
                  setBusy(true);
                  try {
                    const result = await api<{ recipes: RecipeView[]; nextCursor?: string }>(
                      `/recipes?${new URLSearchParams({ feed, q: search, limit: '24', cursor })}`,
                    );
                    if (current === request.current) {
                      setRecipes((items) => [
                        ...items,
                        ...result.recipes.filter(
                          (recipe) => !items.some((item) => item.uri === recipe.uri),
                        ),
                      ]);
                      setCursor(result.nextCursor);
                    }
                  } catch (error) {
                    setError(errorMessage(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Load more
              </Button>
            )}
          </div>
        </TabsContent>
        <div className="modal-footer">
          <Button className="button primary" disabled={busy} onClick={close}>
            Done
          </Button>
        </div>
      </Tabs>
    </Modal>
  );
}
