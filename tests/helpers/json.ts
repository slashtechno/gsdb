// bun-types' Response.json() resolves to `unknown` under strict mode; tests always know
// the shape they expect, so this one cast point avoids repeating `as any` at every call site.
export async function jsonBody(res: Response): Promise<any> {
  return res.json();
}
