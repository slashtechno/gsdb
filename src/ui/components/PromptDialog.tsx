import type { FC } from 'hono/jsx';
import { Modal } from './Modal';

// Single-input modal (Create app, Add column, Rename column).
// The page's <script> defines `window[submitFn](value)` that receives the input value.
export interface PromptDialogProps {
  id: string;
  title: string;
  description: string;
  inputLabel: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel: string;
  submitFn: string; // global JS function name; receives (value)
  cancelLabel?: string;
}

export const PromptDialog: FC<PromptDialogProps> = ({
  id,
  title,
  description,
  inputLabel,
  placeholder,
  initialValue,
  submitLabel,
  submitFn,
  cancelLabel = 'Cancel',
}) => {
  const inputId = `${id}Input`;
  const idCap = id.charAt(0).toUpperCase() + id.slice(1);
  return (
    <Modal
      id={id}
      title={title}
      primaryLabel={submitLabel}
      primaryOnClick={`${submitFn}(document.getElementById('${inputId}').value)`}
      secondaryLabel={cancelLabel}
      secondaryOnClick={`hide${idCap}()`}
    >
      <p style={{ margin: '0 0 12px 0', color: 'var(--muted)' }}>{description}</p>
      <label
        for={inputId}
        style={{
          display: 'block',
          fontSize: '12px',
          color: 'var(--muted)',
          marginBottom: '6px',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {inputLabel}
      </label>
      <input
        id={inputId}
        type="text"
        placeholder={placeholder ?? ''}
        value={initialValue ?? ''}
        onkeypress={`if (event.key === 'Enter') { ${submitFn}(document.getElementById('${inputId}').value); }`}
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
      />
    </Modal>
  );
};
