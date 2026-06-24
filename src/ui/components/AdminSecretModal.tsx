import type { FC } from 'hono/jsx';
import { Button } from './Button';

interface AdminSecretModalProps {
  onSubmit: string; // JavaScript function name to call
}

export const AdminSecretModal: FC<AdminSecretModalProps> = ({ onSubmit }) => {
  return (
    <>
      {/* Backdrop — blocks interaction with content */}
      <div id="modalBackdrop" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'none',
        zIndex: 999,
      }} />
      {/* Modal */}
      <div id="adminModal" style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'var(--surface)',
        borderRadius: '8px',
        padding: '32px',
        maxWidth: '400px',
        width: 'calc(100% - 32px)',
        border: '1px solid var(--border)',
        zIndex: 1000,
        display: 'none',
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
          onkeypress={`if (event.key === 'Enter') ${onSubmit.replace('()', '')}()`}
        />
        <Button
          fullWidth
          onclick={onSubmit}
          style={{ padding: '10px' }}
        >
          Unlock
        </Button>
        <div id="modalError" style={{
          color: 'var(--danger)',
          fontSize: '13px',
          marginTop: '12px',
          display: 'none',
        }} />
      </div>
    </>
  );
};
