// HTML-escape a value for safe interpolation into innerHTML.
// Used by the dashboard's render functions, which build DOM via
// string templates rather than DOM APIs. Always escape user-controlled
// data (app_id, spreadsheet_id, table cell values) before interpolating.
export function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safely embed a server-side string as a JS literal inside an inline <script> block.
// JSON.stringify alone is NOT enough — a value like `foo</script>` would break out
// of the script tag. Replacing < with < keeps the JS semantics intact while
// preventing the HTML parser from treating it as a closing tag.
export function jsEmbed(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
