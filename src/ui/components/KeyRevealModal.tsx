import type { FC } from 'hono/jsx';
import { Modal } from './Modal';
import { Button } from './Button';

// One-time display of an api_key (post-create or post-rotate).
// The key is interpolated into the modal at server-render time via
// JSON.stringify — that is the only safe way to inject a string into an
// inline <script>/<code> block (it escapes quote/bracket characters).
//
// On rotate, the page writes the new key to sessionStorage *before*
// showing this modal, so the rest of the page keeps working.
//
// Exposes stable DOM IDs for client-side updates:
//   {id}Title  — the <h2> heading (set when app_id becomes known)
//   {id}AppId  — the <code>app_id</code> element inside the body
//   {id}Key    — the <code>api_key</code> element
export interface KeyRevealModalProps {
  id: string;
  app_id: string;
  api_key: string;
  // Optional "where to go on Done" callback name. If omitted, Done just
  // hides the modal. The page must define window[<doneFn>] when set.
  doneFn?: string;
  doneLabel?: string;
}

export const KeyRevealModal: FC<KeyRevealModalProps> = ({
  id,
  app_id,
  api_key,
  doneFn,
  doneLabel = 'Done',
}) => {
  const idCap = id.charAt(0).toUpperCase() + id.slice(1);
  return (
    <Modal
      id={id}
      title="Save your API key"
      primaryLabel={doneLabel}
      primaryOnClick={doneFn ? `${doneFn}()` : `hide${idCap}()`}
      footer="This key will not be shown again. Store it in a safe place — you'll need it to call the API for this app."
      width={520}
    >
      <p style={{ margin: '0 0 12px 0' }}>
        Copy this key for <code id={`${id}AppId`} style={{ color: 'var(--accent)' }}>{app_id}</code>:
      </p>
      <div style={{ position: 'relative' }}>
        <code
          id={`${id}Key`}
          style={{
            display: 'block',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '12px 14px',
            fontSize: '13px',
            wordBreak: 'break-all',
            color: 'var(--success, #22c55e)',
            fontFamily: 'var(--mono)',
            userSelect: 'all',
          }}
        >
          {api_key}
        </code>
        <Button
          onclick={`copyKey('${id}Key')`}
          style={{ marginTop: '8px', padding: '6px 14px', fontSize: '13px' }}
        >
          Copy
        </Button>
      </div>
    </Modal>
  );
};