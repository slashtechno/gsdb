import type { FC, CSSProperties } from 'hono/jsx';
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '../styles';

export interface ButtonProps {
  id?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  fullWidth?: boolean;
  onclick?: string;
  style?: CSSProperties;
  children: any;
}

const variantStyles: Record<string, CSSProperties> = {
  primary: primaryBtnStyle,
  secondary: secondaryBtnStyle,
  danger: dangerBtnStyle,
};

export const Button: FC<ButtonProps> = ({
  id,
  variant = 'primary',
  fullWidth = false,
  onclick,
  style: override,
  children,
}) => (
  <button
    id={id}
    onclick={onclick}
    style={{
      ...variantStyles[variant],
      ...(fullWidth ? { width: '100%' } : {}),
      ...override,
    }}
  >
    {children}
  </button>
);
