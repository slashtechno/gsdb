import type { FC, PropsWithChildren } from 'hono/jsx';

export const Layout: FC<PropsWithChildren<{ title?: string }>> = ({
  title = 'gsdb',
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
      <style dangerouslySetInnerHTML={{ __html: `
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #0f1117;
          --surface: #1a1d27;
          --border: #2a2d3d;
          --accent: #6c63ff;
          --accent-hover: #7c74ff;
          --success: #22c55e;
          --danger: #ef4444;
          --text: #e2e8f0;
          --muted: #94a3b8;
          --font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          --mono: 'JetBrains Mono', 'Fira Code', monospace;
        }
        body {
          font-family: var(--font);
          background: var(--bg);
          color: var(--text);
          min-height: 100vh;
        }
        a { color: var(--accent); text-decoration: none; }
        a:hover { text-decoration: underline; }
        code, pre { font-family: var(--mono); }
      ` }} />
    </head>
    <body>{children}</body>
  </html>
);
