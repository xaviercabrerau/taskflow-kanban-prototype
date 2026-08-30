# Diseño: recuperación de contraseña ("olvidé mi contraseña")

## Problema

El login (`src/app/login/page.tsx`) solo soporta iniciar sesión y crear cuenta. No hay forma de que un usuario recupere el acceso si olvida su contraseña — la única vía existente es que un admin la resetee manualmente desde `InviteModal` / `/api/admin/reset-password`, lo cual no escala y depende de un tercero.

## Alcance

Self-service password reset vía Supabase Auth. Fuera de alcance: plantilla de email custom (se usa la default de Supabase), rate-limiting propio (Supabase ya limita el envío), cambios al reset admin-driven existente.

## Diseño

### 1. Modo "forgot" en `/login`

`src/app/login/page.tsx` gana un tercer valor de `mode`: `"signin" | "signup" | "forgot"`.

- En modo `signin`, se agrega un link "¿Olvidaste tu contraseña?" bajo el botón de submit que cambia a `mode = "forgot"`.
- En modo `forgot`, el formulario muestra solo el campo email. Al enviar, llama:
  ```ts
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  ```
- Independientemente de si el email existe o no, se muestra el mismo mensaje de éxito ("Si existe una cuenta con ese correo, recibirás un enlace para restablecer tu contraseña.") — evita enumeración de usuarios vía timing/respuesta.
- Un link "Ya tengo cuenta" regresa a `mode = "signin"`.

### 2. Página `/reset-password`

Nuevo archivo `src/app/reset-password/page.tsx`, client component siguiendo el mismo patrón visual que `/login` (`.modal-backdrop` / `.modal`).

- Al cargar, Supabase ya habrá establecido una sesión de recuperación a partir del hash de la URL del link de email (`detectSessionInUrl` es default `true` en `createBrowserClient`). No se requiere una ruta de callback en servidor.
- Formulario: "Nueva contraseña" + "Confirmar contraseña" (mismo `minLength={6}` que signup para consistencia).
- Validación cliente: ambas contraseñas deben coincidir antes de enviar.
- Al enviar: `await supabase.auth.updateUser({ password })`.
  - Éxito → `router.push("/")` + `router.refresh()`.
  - Error (link expirado/reusado, sin sesión de recuperación) → se muestra `error.message` y un link de vuelta a `/login`.

### 3. Configuración de Supabase Auth

Agregar a la lista de Redirect URLs permitidas del proyecto (`txdyijyswpsalqnwfopc`):
- `https://task.conto.ec/reset-password`
- `http://localhost:3000/reset-password` (dev)

Se aplica vía el MCP de Supabase al implementar (no es un cambio de código).

## Testing

- Test unitario no aplica de forma aislada (es UI + llamada directa al SDK de Supabase); se valida con verificación manual en vivo: solicitar reset, revisar que llega el email, completar el flujo, confirmar login con la nueva contraseña.
- Verificar el caso de error: abrir `/reset-password` directamente sin sesión de recuperación → debe mostrar el error y no crashear.

## Fuera de alcance (explícito)

- Plantilla de email personalizada.
- Rate-limiting adicional al de Supabase.
- Cambios al flujo de reset admin-driven (`InviteModal`).
