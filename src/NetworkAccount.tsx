import { useEffect, useState } from 'react';
import { api, post } from './api';
import { ConfirmDialog, Modal, Notice } from './components';

type Key = { id: string; name: string; prefix: string };
type Proposal = {
  id: string;
  status: string;
  payload: { action: string; recipe?: { title: string }; uri?: string };
};
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
  const [busy, setBusy] = useState(false);
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
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(load);
  }, []);
  return (
    <Modal title="Your account" close={close} wide>
      <div className="network-account-content">
        <Notice error={error} />
        {notice && <p role="status">{notice}</p>}
        <section>
          <h3>Your cookbook</h3>
          <p>Missing recipes you published elsewhere? Refresh your account’s public records.</p>
          <button
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
          </button>
        </section>
        <section>
          <details className="recipe-disclosure">
            <summary>
              <h3>Connected assistants</h3>
            </summary>
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
                <label>
                  Assistant name
                  <input
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={busy}
                  title={busy ? 'Please wait while we work.' : 'Create a new assistant key'}
                  type="submit"
                >
                  Create assistant key
                </button>
              </form>
              {token && (
                <div>
                  <p>
                    Copy this key now; it won’t be shown again. Use it as a Bearer token at{' '}
                    {location.origin}/mcp.
                  </p>
                  <input
                    aria-label="New assistant key"
                    readOnly
                    value={token}
                    onFocus={(e) => e.target.select()}
                  />
                  <div className="network-actions">
                    <button
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
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setToken('')}
                      title="Hide the new key"
                    >
                      Hide key
                    </button>
                  </div>
                </div>
              )}
              {keys.map((key) => (
                <p key={key.id}>
                  {key.name} · {key.prefix}…{' '}
                  <button
                    className="button secondary danger"
                    disabled={busy}
                    title={`Revoke access for ${key.name}. Assistants using this key will stop working.`}
                    onClick={() => setPendingKey(key)}
                  >
                    Revoke
                  </button>
                </p>
              ))}
            </div>
          </details>
        </section>
        <section>
          <h3>Suggested changes</h3>
          <p>
            Review the complete suggestion before approving. Approved recipes become public;
            deletions cannot remove copies others saved.
          </p>
          {!proposals.length && <p>No suggestions yet.</p>}
          {proposals.map((proposal) => (
            <article key={proposal.id}>
              <h4>
                {proposal.payload.action}: {proposal.payload.recipe?.title || 'Recipe'} ·{' '}
                {proposal.status}
              </h4>
              <details>
                <summary>Inspect complete suggestion</summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {JSON.stringify(proposal.payload, null, 2)}
                </pre>
              </details>
              {proposal.status === 'pending' && (
                <div className="network-actions">
                  <button
                    className="button primary"
                    disabled={busy}
                    title="Publish this suggested change to your public cookbook"
                    onClick={() => setPendingProposal(proposal)}
                  >
                    Approve public change
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    title="Dismiss this suggestion without publishing"
                    onClick={() =>
                      void run(() => post(`/proposals/${proposal.id}/review`, { approve: false }))
                    }
                  >
                    Reject
                  </button>
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
          <button
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
          </button>
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
          confirmLabel="Approve public change"
          busy={busy}
          close={() => {
            if (!busy) setPendingProposal(null);
          }}
          confirm={() => {
            const target = pendingProposal;
            void run(async () => {
              await post(`/proposals/${target.id}/review`, { approve: true });
              setPendingProposal(null);
              setNotice('Suggestion approved and published.');
            });
          }}
        >
          <p>
            <strong>
              {pendingProposal.payload.action}: {pendingProposal.payload.recipe?.title || 'Recipe'}
            </strong>{' '}
            will become public on your account.
          </p>
          <p className="confirm-warning">
            Review the complete suggestion above first. Approved recipes become public, and
            deletions cannot remove copies others saved.
          </p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}
