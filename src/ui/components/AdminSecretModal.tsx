import type { FC } from 'hono/jsx';

interface AdminSecretModalProps {
  onSubmit: string; // JavaScript function name to call
}

export const AdminSecretModal: FC<AdminSecretModalProps> = ({ onSubmit }) => {
  return (
    <div id="adminModal" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--surface)',
        borderRadius: '8px',
        padding: '32px',
        maxWidth: '400px',
        width: '100%',
        border: '1px solid var(--border)',
      }}>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600 }}>Admin Secret</h2>
        <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: 'var(--muted)' }}>
          Enter your admin secret to manage apps
        </p>
        <input
          type="password"
          id="secretInput"
          placeholder="Enter admin secret"
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: '14px',
            boxSizing: 'border-box',
            marginBottom: '16px',
          }}
          onkeypress={`if (event.key === 'Enter') ${onSubmit}()`}
        />
        <button
          onclick={onSubmit}
          style={{
            width: '100%',
            padding: '10px',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Unlock
        </button>
      </div>
    </div>
  );
};
