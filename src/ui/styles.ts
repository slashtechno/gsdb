import type { CSSProperties } from 'hono/jsx';

export const primaryBtnStyle: CSSProperties = {
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 'var(--radius)',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.15s, transform 0.1s',
};

export const secondaryBtnStyle: CSSProperties = {
  background: 'transparent',
  color: 'var(--muted)',
  border: '1px solid var(--border)',
  padding: '8px 16px',
  borderRadius: 'var(--radius)',
  fontSize: '13px',
  cursor: 'pointer',
  transition: 'border-color 0.15s, color 0.15s',
};

export const dangerBtnStyle: CSSProperties = {
  background: 'transparent',
  color: 'var(--danger)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  padding: '8px 16px',
  borderRadius: 'var(--radius)',
  fontSize: '13px',
  cursor: 'pointer',
  transition: 'border-color 0.15s, background 0.15s',
};

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: '14px',
  fontFamily: 'var(--mono)',
  outline: 'none',
  transition: 'border-color 0.15s',
};

export const cardStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

export const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '16px',
};

export const sectionTitleStyle: CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
};

export const errorBannerStyle: CSSProperties = {
  background: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  borderRadius: 'var(--radius)',
  padding: '12px 16px',
  color: '#fca5a5',
  fontSize: '14px',
  marginBottom: '16px',
};

export const footerStyle: CSSProperties = {
  display: 'flex',
  gap: '12px',
  color: '#475569',
  fontSize: '13px',
  paddingTop: '16px',
  borderTop: '1px solid #1e2132',
};

export const emptyStateStyle: CSSProperties = {
  textAlign: 'center',
  color: '#64748b',
  padding: '48px 24px',
  fontSize: '14px',
  lineHeight: 1.6,
};
