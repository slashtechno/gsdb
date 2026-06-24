import type { FC, PropsWithChildren } from 'hono/jsx';
import { Button } from './Button';

// Generic modal primitive. Renders a backdrop + panel pair with id-prefixed
// DOM ids so multiple modals can coexist without selector collisions
// (the legacy AdminSecretModal uses unprefixed ids — see the comment there).
//
// Use the helper functions exposed on the page's <script> block:
//   show<Id>() — show this modal
//   hide<Id>() — hide this modal
//
// The standard pattern: the page defines a small <script> that wires up
// buttons / form submit to these globals, similar to AdminSecretModal.
export interface ModalProps {
  id: string;
  title: string;
  width?: number;
  primaryLabel?: string;
  primaryOnClick?: string;
  secondaryLabel?: string;
  secondaryOnClick?: string;
  // Optional footer text (e.g., a warning that something can't be undone).
  footer?: string;
  // Pass danger: true to render the primary button in --danger color.
  // Used by ConfirmDialog for destructive actions.
  danger?: boolean;
}

export const Modal: FC<PropsWithChildren<ModalProps>> = ({
  id,
  title,
  width = 400,
  primaryLabel,
  primaryOnClick,
  secondaryLabel,
  secondaryOnClick,
  footer,
  danger,
  children,
}) => {
  const backdropId = `${id}Backdrop`;
  const modalId = `${id}Modal`;
  const errorId = `${id}Error`;
  return (
    <>
      <div
        id={backdropId}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'none',
          zIndex: 999,
        }}
      />
      <div
        id={modalId}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--surface)',
          borderRadius: '8px',
          padding: '32px',
          maxWidth: `${width}px`,
          width: 'calc(100% - 32px)',
          border: '1px solid var(--border)',
          zIndex: 1000,
          display: 'none',
          boxSizing: 'border-box',
        }}
      >
        <h2 id={`${id}Title`} style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600 }}>{title}</h2>
        <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '20px' }}>
          {children}
        </div>
        {footer && (
          <div
            style={{
              fontSize: '12px',
              color: 'var(--muted)',
              background: 'rgba(108, 99, 255, 0.08)',
              border: '1px solid rgba(108, 99, 255, 0.2)',
              borderRadius: '6px',
              padding: '8px 12px',
              marginBottom: '16px',
            }}
          >
            {footer}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' as const }}>
          {primaryLabel && primaryOnClick && (
            <Button
              variant={danger ? 'danger' : 'primary'}
              fullWidth
              onclick={primaryOnClick}
              style={{ padding: '10px', fontSize: '14px' }}
            >
              {primaryLabel}
            </Button>
          )}
          {secondaryLabel && secondaryOnClick && (
            <Button
              variant="secondary"
              fullWidth
              onclick={secondaryOnClick}
              style={{ padding: '10px', fontSize: '14px' }}
            >
              {secondaryLabel}
            </Button>
          )}
        </div>
        <div
          id={errorId}
          style={{
            color: 'var(--danger)',
            fontSize: '13px',
            marginTop: '12px',
            display: 'none',
          }}
        />
      </div>
    </>
  );
};
