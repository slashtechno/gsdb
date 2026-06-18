import type { FC } from 'hono/jsx';
import { Modal } from './Modal';

// Confirmation modal for destructive actions (Delete app, Remove column, etc).
// Renders a single primary button colored red when `dangerous` is true.
// The inline <script> on the page must define `window[<confirmFn>]` that
// performs the action; the modal just calls it.
export interface ConfirmDialogProps {
  id: string;
  title: string;
  message: string;
  confirmLabel: string;
  confirmFn: string; // global JS function to call
  cancelLabel?: string;
  dangerous?: boolean;
}

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  id,
  title,
  message,
  confirmLabel,
  confirmFn,
  cancelLabel = 'Cancel',
  dangerous,
}) => (
  <Modal
    id={id}
    title={title}
    primaryLabel={confirmLabel}
    primaryOnClick={confirmFn}
    secondaryLabel={cancelLabel}
    secondaryOnClick={`hide${id.charAt(0).toUpperCase() + id.slice(1)}()`}
    danger={dangerous}
  >
    <p style={{ margin: 0, lineHeight: 1.5 }}>{message}</p>
  </Modal>
);
