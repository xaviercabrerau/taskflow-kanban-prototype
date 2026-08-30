# Forward Task by Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user forward a task to an external recipient by email, sent from the organization's connected Gmail account (not a generic no-reply sender), wiring the existing-but-unused `sendViaGmail` into a real UI flow.

**Architecture:** A new server-side API route (`POST /api/tasks/[id]/forward-email`) that looks up the task RLS-scoped, builds a plain-text body from its fields, and calls the existing `sendViaGmail`. A new inline form in `TaskModal`, gated on the org having an active Google integration, calls that route — mirroring the existing "Adjuntar de Drive" inline-form pattern already in the same file.

**Tech Stack:** Next.js App Router route handlers, existing `@/lib/google/gmail.ts` (`sendViaGmail`, unmodified), existing `@/lib/emails/utils.ts` (`taskUrl`, `formatDate`, unmodified), existing `.field`/`.btn`/`.comment-input-wrap`/`.field-error` CSS classes. No new dependencies.

## Global Constraints

- No new npm dependencies.
- `sendViaGmail`, `taskUrl`, and `formatDate` are used as-is — do not modify their signatures or behavior.
- The forward-email UI must only render when the organization has an active Google integration (`integrations.some(i => i.provider === "google" && i.hasCredential && i.isActive)`) — no visible affordance, no error message, when Google isn't connected (per the design spec's explicit choice to hide rather than fail visibly).
- Out of scope (do not build): editing the email subject/body before sending, attaching files to the email, a forward history/log.
- No `.test.tsx`/RTL component tests in this repo (`jest.config.ts` only matches `**/__tests__/**/*.test.ts`, `testEnvironment: 'node'`) — verification for the UI piece is manual (tsc + dev-server check).

---

### Task 1: `POST /api/tasks/[id]/forward-email` endpoint

**Files:**
- Create: `src/app/api/tasks/[id]/forward-email/route.ts`

**Interfaces:**
- Consumes: `sendViaGmail({ tenantId, to, subject, bodyText }): Promise<void>` from `@/lib/google/gmail` (throws on failure); `taskUrl(taskId: string, organizationId: string, baseUrl?: string): string` and `formatDate(date: Date | string, format?: "short" | "long"): string` from `@/lib/emails/utils`; `createClient as createServerSupabase` from `@/lib/supabase/server` (same pattern as `src/app/api/tasks/[id]/drive-attachment/route.ts`).
- Produces: `POST /api/tasks/:id/forward-email` with body `{ to: string; note?: string }`. Responses: `200 { ok: true }` on success; `400 { error }` for a missing/malformed body or `to`; `401 { error: "Unauthorized" }` for no session; `404 { error: "Tarea no encontrada" }` if the task doesn't exist or isn't visible under RLS; `502 { error }` if `sendViaGmail` throws (Google not connected, or Gmail API rejects the send). Task 2's UI depends on this exact contract (status codes and the `error` field name).

- [ ] **Step 1: Create the route with auth, validation, and task lookup**

Create `src/app/api/tasks/[id]/forward-email/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { sendViaGmail } from "@/lib/google/gmail";
import { taskUrl, formatDate } from "@/lib/emails/utils";

/**
 * POST /api/tasks/[id]/forward-email
 * Body: { to: string; note?: string }
 * Forwards a task's summary to an external recipient, sent from the org's
 * connected Gmail account (sendViaGmail), not a generic sender. Runs
 * server-side because it needs the org's Google access token.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: taskId } = await params;

  const supabase = await createServerSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { to?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const to = body.to?.trim();
  if (!to || !to.includes("@")) {
    return NextResponse.json(
      { error: "Se requiere un email de destinatario válido." },
      { status: 400 }
    );
  }
  const note = body.note?.trim();

  // RLS-scoped select: only succeeds if the caller is a member of the
  // task's organization — same authorization boundary every other
  // task-related read/write in this app relies on.
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, tenant_id, title, description, priority, due_date")
    .eq("id", taskId)
    .maybeSingle();

  if (taskError || !task) {
    return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  }

  const bodyLines = [
    task.title,
    "",
    task.description || "(sin descripción)",
    "",
    `Prioridad: ${task.priority}`,
    `Vencimiento: ${task.due_date ? formatDate(task.due_date, "long") : "sin fecha"}`,
    "",
  ];
  if (note) {
    bodyLines.push(`Nota: ${note}`, "");
  }
  bodyLines.push(`Ver tarea completa: ${taskUrl(task.id, task.tenant_id)}`);

  try {
    await sendViaGmail({
      tenantId: task.tenant_id,
      to,
      subject: task.title,
      bodyText: bodyLines.join("\n"),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/app/api/tasks/[id]/forward-email/route.ts`.

- [ ] **Step 3: Manual verification (validation paths only — Task 2 wires the real send)**

Run the dev server. With a valid session cookie, `curl` the route directly for the paths that don't need a real Google connection:
- Missing `to`: `curl -X POST http://localhost:3300/api/tasks/<a-real-task-id>/forward-email -H 'Content-Type: application/json' -d '{}' --cookie '<session-cookie>'` → expect `400`.
- Unknown task id: same call with a random UUID → expect `404`.
- Valid `to` on an org without Google connected: expect `502` with a message mentioning Gmail isn't connected (from `sendViaGmail`'s own error) — this also confirms the endpoint reaches `sendViaGmail` correctly end-to-end short of the actual send.

(Getting a browser session cookie for `curl`: open the app logged in, DevTools → Application → Cookies → copy the `sb-*-auth-token` cookie value(s) into the `--cookie` flag, or simpler — perform this same verification from Task 2's UI once it exists, and treat this step as satisfied by Task 2's manual check instead. Either is acceptable; don't block on constructing a raw curl session if the browser check is easier.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/tasks/[id]/forward-email/route.ts
git commit -m "feat: add forward-task-by-email endpoint via connected Gmail"
```

---

### Task 2: Wire "Reenviar por email" into `TaskModal`

**Files:**
- Modify: `src/components/TaskModal.tsx`

**Interfaces:**
- Consumes: `POST /api/tasks/:id/forward-email` from Task 1 — body `{ to, note? }`, success `{ ok: true }`, error `{ error: string }` on 400/404/502. Consumes `integrations: Integration[]` already returned by `useBoard()` (each item has `provider: IntegrationProvider`, `hasCredential: boolean`, `isActive: boolean` — confirmed via `src/components/IntegrationsModal.tsx:76` and `src/context/BoardContext.tsx`'s `integrations` state).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add `integrations` to the `useBoard()` destructure and compute `googleConnected`**

In `src/components/TaskModal.tsx`, change line 71 from:

```tsx
  const { can, supabase, userId, tenantId, members } = useBoard();
```

to:

```tsx
  const { can, supabase, userId, tenantId, members, integrations } = useBoard();
```

Then, right after the `taskId` line (currently line 81: `const taskId = mode === "edit" ? initial?.id : undefined;`), add:

```tsx
  const googleConnected = integrations.some(
    (i) => i.provider === "google" && i.hasCredential && i.isActive
  );
```

- [ ] **Step 2: Add forward-email state**

Near the existing Drive-attach state (currently lines 101-103: `attachments`, `driveLink`, `attachingDrive`), add:

```tsx
  const [forwardEmailOpen, setForwardEmailOpen] = useState(false);
  const [forwardTo, setForwardTo] = useState("");
  const [forwardNote, setForwardNote] = useState("");
  const [forwardingEmail, setForwardingEmail] = useState(false);
  const [forwardResult, setForwardResult] = useState<{ ok: boolean; message: string } | null>(null);
```

- [ ] **Step 3: Add the submit handler**

Add this function near `handleAttachDriveLink` (after it, so it sits with the other task-detail-page handlers):

```tsx
  async function handleForwardEmail(e: React.FormEvent) {
    e.preventDefault();
    const to = forwardTo.trim();
    if (!to || !taskId || forwardingEmail) return;
    setForwardingEmail(true);
    setForwardResult(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/forward-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, note: forwardNote.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "No se pudo enviar el email.");
      }
      setForwardResult({ ok: true, message: `Tarea reenviada a ${to}.` });
      setForwardTo("");
      setForwardNote("");
    } catch (err) {
      setForwardResult({
        ok: false,
        message: err instanceof Error ? err.message : "No se pudo enviar el email.",
      });
    } finally {
      setForwardingEmail(false);
    }
  }
```

- [ ] **Step 4: Add the UI section**

The Adjuntos section starts at (currently) line 789 with `<div className="field task-section">` and ends before the checklist section starts. Add a new sibling section immediately after that Adjuntos `</div>` block closes (find the closing `</div>` that matches line 789's opening — it's the one right before the next `<div className="field task-section">` for checklists/comments). Insert:

```tsx
              {taskId && googleConnected && (
                <div className="field task-section">
                  <label>Reenviar por email</label>
                  {!forwardEmailOpen ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setForwardEmailOpen(true);
                        setForwardResult(null);
                      }}
                    >
                      📧 Reenviar por email
                    </button>
                  ) : (
                    <form onSubmit={handleForwardEmail}>
                      <div className="comment-input-wrap" style={{ marginTop: 8 }}>
                        <input
                          type="email"
                          value={forwardTo}
                          onChange={(e) => setForwardTo(e.target.value)}
                          placeholder="Email del destinatario"
                          disabled={forwardingEmail}
                          required
                        />
                      </div>
                      <textarea
                        value={forwardNote}
                        onChange={(e) => setForwardNote(e.target.value)}
                        placeholder="Nota (opcional)"
                        disabled={forwardingEmail}
                        rows={2}
                        style={{ width: "100%", marginTop: 8 }}
                      />
                      <div style={{ marginTop: 8 }}>
                        <button
                          type="submit"
                          className="btn primary"
                          disabled={!forwardTo.trim() || forwardingEmail}
                        >
                          {forwardingEmail ? "Enviando…" : "Enviar"}
                        </button>
                      </div>
                    </form>
                  )}
                  {forwardResult && (
                    <p
                      role={forwardResult.ok ? undefined : "alert"}
                      className={forwardResult.ok ? undefined : "field-error"}
                      style={forwardResult.ok ? { color: "var(--low)", fontSize: 13.5 } : undefined}
                    >
                      {forwardResult.message}
                    </p>
                  )}
                </div>
              )}
```

Note: `.field-error` is the existing class this file already uses for error `<p>` tags (e.g. `attachmentsError`, confirmed at line 791) — reuse it verbatim, don't invent a new error style.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/components/TaskModal.tsx`.

- [ ] **Step 6: Manual verification**

Run the dev server, open a task in an org **without** Google connected: confirm no "Reenviar por email" section appears anywhere in the modal.

Open a task in an org **with** Google connected (active integration): confirm the section appears, click the button, fill a real recipient email, submit, and confirm:
- A success message appears and the email actually arrives (check the recipient's inbox).
- The email's subject matches the task title, and the body contains the description, priority, due date (or "sin fecha"), the optional note if provided, and a working link back to the task.
- Submitting with an empty "to" is blocked client-side (the browser's own `required`/`type="email"` validation, or the disabled submit button).

- [ ] **Step 7: Commit**

```bash
git add src/components/TaskModal.tsx
git commit -m "feat: wire forward-task-by-email UI into TaskModal"
```
