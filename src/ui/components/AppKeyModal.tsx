import type { FC } from 'hono/jsx';
import { Modal } from './Modal';

// Prompts the user to enter (or re-enter) the api_key for an app.
// On submit, the key is written to sessionStorage (keyed by app_id) and
// the page is reloaded — the simplest way to re-run page init with the key
// present in the JS environment.
//
// On any 401/403 from /api/{app_id}/* calls, the page's fetch wrapper
// should clear sessionStorage and call show<Id>() to re-prompt.
export interface AppKeyModalProps {
  app_id: string;
}

export const AppKeyModal: FC<AppKeyModalProps> = ({ app_id }) => {
  const id = 'appKey';
  const inputId = `${id}Input`;
  const idCap = id.charAt(0).toUpperCase() + id.slice(1);
  return (
    <Modal
      id={id}
      title="API Key"
      primaryLabel="Unlock"
      primaryOnClick={`submitAppKey()`}
      secondaryLabel="Cancel"
      secondaryOnClick={`hide${idCap}(); location.href='/ui';`}
      footer="The key is shown once at app creation. Get it from your records, or rotate the key from the app page."
    >
      <p style={{ margin: '0 0 12px 0', color: 'var(--muted)' }}>
        Enter the API key for <code style={{ color: 'var(--accent)' }}>{app_id}</code> to load its data.
      </p>
      <input
        id={inputId}
        type="password"
        placeholder="gsdb_..."
        onkeypress={`if (event.key === 'Enter') { submitAppKey(); }`}
        style={{
          width: '100%',
          padding: '10px 12px',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          background: 'var(--bg)',
          color: 'var(--text)',
          fontSize: '14px',
          boxSizing: 'border-box',
          marginBottom: '8px',
          fontFamily: 'var(--mono)',
        }}
      />
    </Modal>
  );
};
