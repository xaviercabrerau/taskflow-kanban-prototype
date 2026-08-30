# Forgot Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user who forgot their password recover access themselves, without an admin, via Supabase Auth's built-in password-recovery email flow.

**Architecture:** All client-side, reusing the existing Supabase browser client (`src/lib/supabase/client.ts`) and the login page's existing modal styling. A new `forgot` mode on `/login` triggers `supabase.auth.resetPasswordForEmail`. A new `/reset-password` page (reachable via the email link) calls `supabase.auth.updateUser({ password })` once Supabase has auto-detected the recovery session from the URL fragment. `src/proxy.ts` must be updated so `/reset-password` is reachable by a signed-out visitor (it currently only exempts `/login` from the "no session → redirect to /login" rule).

**Tech Stack:** Next.js App Router (client components), `@supabase/ssr` (`createBrowserClient`), existing `.modal` / `.field` / `.btn` CSS classes from `globals.css`. No new dependencies.

## Global Constraints

- Password minimum length: 6 characters (matches the existing `minLength={6}` on the signup password field in `src/app/login/page.tsx:81`).
- Do not reveal whether an email address has an account: the "forgot" mode shows the same success message regardless of whether `resetPasswordForEmail` succeeds or the email is unregistered.
- No new npm dependencies.
- No test files use `.test.tsx` / RTL in this repo (`jest.config.ts` only matches `**/__tests__/**/*.test.ts`, `testEnvironment: 'node'`) — do not introduce component-level test scaffolding that doesn't match this. Verification for the two page components is manual, exactly as documented in `docs/superpowers/specs/2026-08-29-forgot-password-design.md`.
- Redirect URL allow-listing in Supabase Auth (Dashboard → Authentication → URL Configuration) is **not** exposed through any available Supabase MCP tool (`mcp__supabase__*`/`mcp__plugin_supabase-toolkit_supabase__*` — checked the full tool list, none manage Auth redirect URLs). This step must be done manually by the user in the Supabase Dashboard. Flagged explicitly in Task 3.

---

### Task 1: Add "forgot password" mode to `/login`

**Files:**
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `createClient()` from `@/lib/supabase/client` (already imported, line 5) — specifically `supabase.auth.resetPasswordForEmail(email: string, options?: { redirectTo?: string }): Promise<{ data: {}; error: AuthError | null }>`.
- Produces: nothing consumed by later tasks (Task 2 is an independent page). The `redirectTo` URL (`${window.location.origin}/reset-password`) must match the route Task 2 creates.

- [ ] **Step 1: Extend `mode` state and add the "forgot" submit branch**

Edit `src/app/login/page.tsx`. Change line 11 from:

```tsx
const [mode, setMode] = useState<"signin" | "signup">("signin");
```

to:

```tsx
const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
```

Then in `handleSubmit` (currently lines 24-53), add a branch for `forgot` mode before the existing `signin` check. Replace:

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    if (mode === "signin") {
```

with:

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    if (mode === "forgot") {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setLoading(false);
      // Same message whether or not the email has an account — avoids
      // leaking which emails are registered.
      setInfo(
        "Si existe una cuenta con ese correo, recibirás un enlace para restablecer tu contraseña."
      );
      return;
    }
    if (mode === "signin") {
```

- [ ] **Step 2: Add the "¿Olvidaste tu contraseña?" link and adjust the form for `forgot` mode**

Replace the modal head (line 58-60):

```tsx
        <div className="modal-head">
          <h2>{mode === "signin" ? "Iniciar sesión" : "Crear cuenta"}</h2>
        </div>
```

with:

```tsx
        <div className="modal-head">
          <h2>
            {mode === "signin"
              ? "Iniciar sesión"
              : mode === "signup"
                ? "Crear cuenta"
                : "Recuperar contraseña"}
          </h2>
        </div>
```

Replace the password field block (lines 73-83) so it's hidden in `forgot` mode:

```tsx
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
```

with:

```tsx
          {mode !== "forgot" && (
            <div className="field">
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          )}
```

Replace the `emailDomain && <SsoLoginSection .../>` line (line 90) — SSO only makes sense for `signin`:

```tsx
          {emailDomain && <SsoLoginSection domain={emailDomain} onError={setError} />}
```

with:

```tsx
          {mode === "signin" && emailDomain && (
            <SsoLoginSection domain={emailDomain} onError={setError} />
          )}
          {mode === "signin" && (
            <button
              type="button"
              className="link-button"
              style={{ fontSize: 13, marginTop: 4 }}
              onClick={() => {
                setError(null);
                setInfo(null);
                setMode("forgot");
              }}
            >
              ¿Olvidaste tu contraseña?
            </button>
          )}
```

Replace the modal foot buttons (lines 92-103):

```tsx
        <div className="modal-foot">
          <button
            type="button"
            className="btn"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Crear cuenta nueva" : "Ya tengo cuenta"}
          </button>
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "..." : mode === "signin" ? "Entrar" : "Registrarme"}
          </button>
        </div>
```

with:

```tsx
        <div className="modal-foot">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setError(null);
              setInfo(null);
              setMode(mode === "signup" ? "signin" : mode === "forgot" ? "signin" : "signup");
            }}
          >
            {mode === "signin" ? "Crear cuenta nueva" : "Ya tengo cuenta"}
          </button>
          <button type="submit" className="btn primary" disabled={loading}>
            {loading
              ? "..."
              : mode === "signin"
                ? "Entrar"
                : mode === "signup"
                  ? "Registrarme"
                  : "Enviar enlace"}
          </button>
        </div>
```

- [ ] **Step 3: Add a minimal `.link-button` style if it doesn't already exist**

Run this to check:

```bash
grep -n "\.link-button" src/app/globals.css
```

If no match is found, add this near the other simple utility classes at the end of `src/app/globals.css`:

```css
.link-button {
  background: none;
  border: none;
  color: var(--accent, #2f7d6b);
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
  text-align: left;
}
```

If a match is found, skip this step (reuse the existing class as-is — do not create a duplicate).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/app/login/page.tsx`.

- [ ] **Step 5: Manual verification**

Run the dev server (`npm run dev`), open `/login`, click "¿Olvidaste tu contraseña?", confirm:
- The heading changes to "Recuperar contraseña".
- The password field disappears.
- The submit button reads "Enviar enlace".
- Submitting shows the info message and does not throw a console error.
- "Ya tengo cuenta" returns to sign-in mode.

- [ ] **Step 6: Commit**

```bash
git add src/app/login/page.tsx src/app/globals.css
git commit -m "feat: add forgot-password mode to login page"
```

---

### Task 2: Create `/reset-password` page and make it reachable when signed out

**Files:**
- Create: `src/app/reset-password/page.tsx`
- Modify: `src/proxy.ts:89`

**Interfaces:**
- Consumes: `createClient()` from `@/lib/supabase/client`, specifically `supabase.auth.updateUser({ password: string }): Promise<{ data: { user: User | null }; error: AuthError | null }>`. Consumes the same `redirectTo` route Task 1 wired (`/reset-password`) — this task's file path must be exactly `src/app/reset-password/page.tsx` to match.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Update `src/proxy.ts` so `/reset-password` is reachable without a session**

The recovery link from Supabase carries the session token in the URL **fragment** (`#access_token=...`), which browsers never send to the server — so on first load of `/reset-password`, `proxy.ts`'s `supabase.auth.getUser()` sees no session yet. Today only `/login` is exempted from the "no session → redirect to `/login`" rule (`src/proxy.ts:89`), so `/reset-password` would currently bounce straight back to `/login` before the client ever gets to parse the recovery link.

Replace (`src/proxy.ts:89-96`):

```ts
  const isAuthRoute = request.nextUrl.pathname.startsWith("/login");
  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirectResponse = NextResponse.redirect(url);
    redirectResponse.headers.set("x-request-id", requestId);
    return redirectResponse;
  }
  if (user && isAuthRoute) {
```

with:

```ts
  const isLoginRoute = request.nextUrl.pathname.startsWith("/login");
  const isPublicAuthRoute =
    isLoginRoute || request.nextUrl.pathname.startsWith("/reset-password");
  if (!user && !isPublicAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirectResponse = NextResponse.redirect(url);
    redirectResponse.headers.set("x-request-id", requestId);
    return redirectResponse;
  }
  if (user && isLoginRoute) {
```

Note: the "already signed in" redirect-to-`/` rule intentionally stays scoped to `isLoginRoute` only (not `isPublicAuthRoute`) — a user who already has an ordinary session in the same browser must still be able to open `/reset-password` and complete the recovery flow, not get bounced to `/` before the page can process the link.

- [ ] **Step 2: Create the reset-password page**

Create `src/app/reset-password/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="modal-backdrop" style={{ position: "static", minHeight: "100vh" }}>
      <form className="modal" style={{ width: 360 }} onSubmit={handleSubmit}>
        <div className="modal-head">
          <h2>Elegir nueva contraseña</h2>
        </div>
        <div className="modal-body">
          <div className="field">
            <label htmlFor="new-password">Nueva contraseña</label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirmar contraseña</label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {error && (
            <p style={{ color: "var(--high)", fontSize: 13.5 }}>
              {error}{" "}
              <a href="/login" style={{ color: "inherit" }}>
                Volver a iniciar sesión
              </a>
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "..." : "Guardar contraseña"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/app/reset-password/page.tsx` or `src/proxy.ts`.

- [ ] **Step 4: Manual verification of the error path**

Run the dev server, open `/reset-password` directly (no recovery session). Confirm:
- The page renders (not redirected to `/login` — this proves the Step 1 proxy fix works).
- Submitting the form shows an error from `updateUser` (Supabase rejects the update with no valid session) and a working "Volver a iniciar sesión" link, without a crash.

- [ ] **Step 5: Commit**

```bash
git add src/app/reset-password/page.tsx src/proxy.ts
git commit -m "feat: add reset-password page and allow it as a public auth route"
```

---

### Task 3: Configure Supabase redirect URLs and verify the full flow end-to-end

**Files:** none (configuration + manual verification only).

**Interfaces:** none — this task validates Tasks 1 and 2 together.

- [ ] **Step 1: Tell the user to add the redirect URLs (manual — no MCP tool covers this)**

Ask the user to open the Supabase Dashboard for project `txdyijyswpsalqnwfopc` → **Authentication → URL Configuration → Redirect URLs**, and add:
- `https://task.conto.ec/reset-password`
- `http://localhost:3000/reset-password`

Do not proceed to Step 2 until the user confirms this is done — `resetPasswordForEmail`'s `redirectTo` is silently ignored (Supabase falls back to the default Site URL) if the URL isn't allow-listed, which would otherwise look like a mysterious bug during verification.

- [ ] **Step 2: Full build check**

Run: `npm run build`
Expected: build succeeds with no type or lint errors.

- [ ] **Step 3: Run the existing test suite**

Run: `npx jest --forceExit`
Expected: all existing suites still pass (this feature adds no `.test.ts` files per the Global Constraints — this step only guards against an accidental regression, e.g. in `src/proxy.ts`).

- [ ] **Step 4: Live end-to-end verification in production or a deployed preview**

1. Go to `/login`, click "¿Olvidaste tu contraseña?", submit a real, accessible email address.
2. Confirm the email arrives (Supabase's default "Reset Password" template) and the link points at `/reset-password`.
3. Click the link, confirm it lands on `/reset-password` (not redirected to `/login`).
4. Submit a new password, confirm redirect to `/` and that the board loads (i.e. a real session exists).
5. Sign out, sign back in with the new password at `/login` to confirm the password actually changed.

- [ ] **Step 5: Update documentation**

Add a short note to `docs/USER_MANAGEMENT.md` (or the closest existing doc covering login/account recovery — check with `grep -n "contraseña\|password" docs/USER_MANAGEMENT.md` first) describing the new self-service flow, so it isn't only discoverable by reading `src/app/login/page.tsx`. Keep it to 3-5 sentences: what it does, where the link lives, and that it requires the redirect URLs from Step 1 to stay configured in Supabase.

- [ ] **Step 6: Commit**

```bash
git add docs/USER_MANAGEMENT.md
git commit -m "docs: document the self-service forgot-password flow"
```
