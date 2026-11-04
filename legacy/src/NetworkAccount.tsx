import { Button, Input, Label, Disclosure } from './ui';
import { useEffect, useState } from 'react';
import { api, post } from './api';
import { ConfirmDialog, Modal, Notice } from './components';
import { PlannerPreferences } from './features/planner/PlannerDialogs';
import type { RecipeInput } from '../shared/atproto';
import { recipeUrl, appUrl } from './routes';
import { RecipeTags, recipeTime, recipeYield } from './RecipePresentation';

type Key = { id: string; name: string; prefix: string };
type Proposal = {
  id: string;
  status: string;
  payload: { action: string; recipe?: Partial<RecipeInput>; uri?: string };
};
const proposalAction = (action: string) =>
  action === 'delete' ? 'Delete recipe' : action === 'update' ? 'Update recipe' : 'New recipe';

function ProposalReview({ payload }: { payload: Proposal['payload'] }) {
  const recipe = payload.recipe;
  const time = recipe && recipeTime(recipe);
  return (
    <div className="proposal-review">
      {payload.uri && (
        <p>
          <a href={appUrl(recipeUrl(payload.uri))} target="_blank" rel="noreferrer">
            View the current recipe ↗
          </a>
        </p>
      )}
      {payload.action === 'delete' ? (
        <p>
          This suggestion permanently deletes the public recipe. Copies saved by other people may
          remain.
        </p>
      ) : recipe ? (
        <>
          {recipe.summary && <p>{recipe.summary}</p>}
          {time && (
            <p>
              {time.minutes} min · {time.label.toLowerCase()}
            </p>
          )}
          {recipeYield(recipe) && <p>Serves / makes: {recipeYield(recipe)}</p>}
          <RecipeTags tags={recipe.tags} />
          {!!recipe.ingredients?.length && (
            <>
              <h5>Ingredients</h5>
              <ul>
                {recipe.ingredients.map((item, index) => (
                  <li key={index}>
                    {item.group && <strong>{item.group}: </strong>}
                    {[item.quantity, item.unit, item.name, item.preparation]
                      .filter(Boolean)
                      .join(' ')}
                  </li>
                ))}
              </ul>
            </>
          )}
          {!!recipe.instructions?.length && (
            <>
              <h5>Steps</h5>
              <ol>
                {recipe.instructions.map((step, index) => (
                  <li key={index}>
                    {step.group && <strong>{step.group}: </strong>}
                    {step.text}
                  </li>
                ))}
              </ol>
            </>
          )}
          {recipe.description && <p className="network-prose">{recipe.description}</p>}
          {recipe.source && <p>Source: {recipe.source.name || recipe.source.url}</p>}
          {recipe.adaptationNote && <p>{recipe.adaptationNote}</p>}
        </>
      ) : null}
    </div>
  );
}
export function NetworkAccount({
  close,
  onSignOut,
}: {
  close: () => void;
  onSignOut: () => Promise<void>;
}) {
  const [keys, setKeys] = useState<Key[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const [pendingKey, setPendingKey] = useState<Key | null>(null);
  const [pendingProposal, setPendingProposal] = useState<Proposal | null>(null);
  async function load() {
    const [k, p] = await Promise.all([
      api<{ keys: Key[] }>('/keys'),
      api<{ proposals: Proposal[] }>('/proposals'),
    ]);
    setKeys(k.keys);
    setProposals(p.proposals);
  }
  async function run(work?: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run();
  }, []);
  return (
    <Modal title="Your account" close={close} wide>
      <div className="network-account-content">
        <Notice error={error} />
        {error && (
          <Button className="text-button" disabled={busy} onClick={() => void run()}>
            Reload account
          </Button>
        )}
        {notice && <p role="status">{notice}</p>}
        <PlannerPreferences />
        <section>
          <h3>Your cookbook</h3>
          <p>Missing recipes you published elsewhere? Refresh your account’s public records.</p>
          <Button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await post('/sync', {});
                setNotice('Cookbook refreshed. Reopen your feed to see changes.');
              })
            }
          >
            Refresh cookbook
          </Button>
        </section>
        <section>
          <Disclosure className="recipe-disclosure" title="Connected assistants">
            <div className="stack">
              <p>
                Assistants can read recipes and suggest changes. Only you can approve publication
                here. Keep keys private.
              </p>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const result = await post<{ token: string }>('/keys', { name });
                    setToken(result.token);
                    setName('');
                  });
                }}
              >
                <Label>
                  Assistant name
                  <Input
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Label>
                <Button
                  className="button secondary"
                  disabled={busy}
                  title={busy ? 'Please wait while we work.' : 'Create a new assistant key'}
                  type="submit"
                >
                  Create assistant key
                </Button>
              </form>
              {token && (
                <div>
                  <p>
                    Copy this key now; it won’t be shown again. Use it as a Bearer token at{' '}
                    {location.origin}/mcp.
                  </p>
                  <Input
                    aria-label="New assistant key"
                    readOnly
                    value={token}
                    onFocus={(e) => e.target.select()}
                  />
                  <div className="network-actions">
                    <Button
                      type="button"
                      className="button secondary"
                      title="Copy the new key to the clipboard"
                      onClick={() => {
                        if (navigator.clipboard?.writeText) {
                          void navigator.clipboard
                            .writeText(token)
                            .then(() => {
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2500);
                            })
                            .catch(() => setError('Could not copy the key.'));
                        }
                      }}
                    >
                      {copied ? 'Copied!' : 'Copy key'}
                    </Button>
                    <Button
                      className="button secondary"
                      onClick={() => setToken('')}
                      title="Hide the new key"
                    >
                      Hide key
                    </Button>
                  </div>
                </div>
              )}
              {keys.map((key) => (
                <p key={key.id}>
                  {key.name} · {key.prefix}…{' '}
                  <Button
                    className="button secondary danger"
                    disabled={busy}
                    title={`Revoke access for ${key.name}. Assistants using this key will stop working.`}
                    onClick={() => setPendingKey(key)}
                  >
                    Revoke
                  </Button>
                </p>
              ))}
            </div>
          </Disclosure>
        </section>
        <section>
          <h3>Suggested changes</h3>
          <p>
            Review the complete suggestion before approving. Approved recipes become public;
            deletions cannot remove copies others saved.
          </p>
          {!proposals.length && (
            <p role="status">{busy ? 'Loading suggestions…' : 'No suggestions yet.'}</p>
          )}
          {proposals.map((proposal) => (
            <article key={proposal.id}>
              <h4>
                {proposalAction(proposal.payload.action)}:{' '}
                {proposal.payload.recipe?.title || 'Recipe'} · {proposal.status}
              </h4>
              <ProposalReview payload={proposal.payload} />
              <Disclosure title="Complete suggestion data">
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {JSON.stringify(proposal.payload, null, 2)}
                </pre>
              </Disclosure>
              {proposal.status === 'pending' && (
                <div className="network-actions">
                  <Button
                    className="button primary"
                    disabled={busy}
                    title={
                      proposal.payload.action === 'delete'
                        ? 'Review this suggested deletion before removing the recipe'
                        : 'Publish this suggested change to your public cookbook'
                    }
                    onClick={() => setPendingProposal(proposal)}
                  >
                    {proposal.payload.action === 'delete'
                      ? 'Review deletion'
                      : 'Approve public change'}
                  </Button>
                  <Button
                    className="button secondary"
                    disabled={busy}
                    title="Dismiss this suggestion without publishing"
                    onClick={() =>
                      void run(() => post(`/proposals/${proposal.id}/review`, { approve: false }))
                    }
                  >
                    Reject
                  </Button>
                </div>
              )}
              {proposal.status === 'applying' && (
                <p>
                  The outcome needs checking. Refresh your cookbook and contact the operator before
                  retrying; the change may already be published.
                </p>
              )}
            </article>
          ))}
        </section>
        <section className="network-account-signout">
          <Button
            className="button secondary"
            disabled={busy}
            title="Sign out of brownbag on this device"
            onClick={() => {
              setBusy(true);
              setError('');
              void onSignOut().catch((e) => {
                setError(e instanceof Error ? e.message : 'Please try again.');
                setBusy(false);
              });
            }}
          >
            Sign out
          </Button>
        </section>
      </div>
      {pendingKey && (
        <ConfirmDialog
          title="Revoke this key?"
          confirmLabel="Revoke key"
          danger
          busy={busy}
          close={() => {
            if (!busy) setPendingKey(null);
          }}
          confirm={() => {
            const target = pendingKey;
            void run(async () => {
              await api(`/keys/${target.id}`, { method: 'DELETE' });
              setPendingKey(null);
              setNotice(`Revoked access for ${target.name}.`);
            });
          }}
        >
          <p>
            <strong>{pendingKey.name}</strong> ({pendingKey.prefix}…) will stop working immediately.
          </p>
          <p className="confirm-warning">
            Assistants using this key lose access right away. This cannot be undone — create a new
            key if you need access again.
          </p>
        </ConfirmDialog>
      )}
      {pendingProposal && (
        <ConfirmDialog
          title="Approve this change?"
          confirmLabel={
            pendingProposal.payload.action === 'delete'
              ? 'Delete public recipe'
              : 'Approve public change'
          }
          danger={pendingProposal.payload.action === 'delete'}
          busy={busy}
          close={() => {
            if (!busy) setPendingProposal(null);
          }}
          confirm={() => {
            const target = pendingProposal;
            void run(async () => {
              await post(`/proposals/${target.id}/review`, { approve: true });
              setPendingProposal(null);
              setNotice(
                target.payload.action === 'delete'
                  ? 'Suggested deletion approved. Recipe deleted.'
                  : 'Suggestion approved and published.',
              );
            });
          }}
        >
          <p>
            <strong>
              {proposalAction(pendingProposal.payload.action)}:{' '}
              {pendingProposal.payload.recipe?.title || 'Recipe'}
            </strong>{' '}
            {pendingProposal.payload.action === 'delete'
              ? 'will permanently delete the public recipe from your account.'
              : 'will become public on your account.'}
          </p>
          <p className="confirm-warning">
            Review the complete suggestion above first.{' '}
            {pendingProposal.payload.action === 'delete'
              ? 'Deletion cannot remove copies others saved.'
              : 'Approved recipes become public and can be copied by others.'}
          </p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}
