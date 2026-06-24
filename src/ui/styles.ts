import type { CSSProperties } from 'hono/jsx';

// Shared button style variants. Pages and components import these instead of
// re-declaring the same objects. Combine with a spread to add overrides:
//   <button style={{ ...primaryBtnStyle, marginLeft: 'auto' }}>
export const primaryBtnStyle: CSSProperties = {
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

export const secondaryBtnStyle: CSSProperties = {
  background: 'transparent',
  color: 'var(--muted)',
  border: '1px solid var(--border)',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '13px',
  cursor: 'pointer',
};

export const dangerBtnStyle: CSSProperties = {
  background: 'transparent',
  color: 'var(--danger)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '13px',
  cursor: 'pointer',
};
