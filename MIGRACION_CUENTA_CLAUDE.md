# Migración de cuenta de Claude — guía de referencia

**Fecha:** 2026-09-11
**Motivo:** cambio a una cuenta de Claude de otra organización/equipo.
**Alcance:** este documento cubre tu cuenta y entorno de Claude Code (memoria,
configuración, conexiones MCP, contexto de sesión). Para migrar el *proyecto*
TaskFlow a otras cuentas de GitHub/Vercel/Supabase, ver [`MIGRACION.md`](MIGRACION.md)
— son migraciones independientes y puedes hacer una sin la otra.

**Cómo usar esto:** este documento es la referencia completa. Para que alguien
(tú, en la cuenta nueva) lo recorra paso a paso con verificación en cada punto,
usa el skill wizard en [`.agents/skills/migracion-cuenta-claude/SKILL.md`](.agents/skills/migracion-cuenta-claude/SKILL.md)
— pídele a Claude Code, ya en la sesión con la cuenta nueva, algo como "usa el
skill de migración de cuenta" y te irá preguntando y verificando cada ítem.

---

## Lo primero: qué es "cuenta" vs. "máquina" aquí

Hay tres capas independientes, y no todas dependen de la cuenta de Claude:

| Capa | Dónde vive | ¿Depende de la cuenta? |
|---|---|---|
| Memoria de este proyecto | `~/.claude/projects/<slug-de-la-ruta>/memory/` | **No** — depende de la ruta local del proyecto, no del login |
| Historial de sesiones/conversaciones | `~/.claude/projects/<slug-de-la-ruta>/*.jsonl` | **No** (verificado: son archivos locales) — pero sí depende de que sigas en la misma máquina y misma ruta de proyecto |
| Configuración de la instalación de Claude Code (`~/.claude/settings.json`, plugins, marketplaces) | Global a la máquina/usuario del sistema operativo | **Parcialmente** — algunos valores (auth tokens) son específicos de la cuenta actual |
| Conexiones MCP / integraciones (`claude.ai <servicio>`, y varios `plugin:<paquete>:<servicio>`) | Autenticadas por OAuth, asociadas a la cuenta | **Sí** — necesitan reconectarse en la cuenta nueva |
| Configuración del proyecto (`CLAUDE.md`, `AGENTS.md`, `.claude/launch.json`, skills en `.agents/skills/`) | Dentro del repo git | **No** — viaja automáticamente con `git clone`/`git pull`, sin importar la cuenta |

En corto: si vas a **seguir en esta misma máquina** y solo cambias con qué
cuenta inicias sesión en Claude Code, la memoria y el historial de esta
conversación deberían seguir apareciendo solos (viven en el disco, no en un
servidor atado a tu login). Lo que sí necesita trabajo manual son las
integraciones MCP que dependen de OAuth de cuenta.

Si en cambio la cuenta nueva implica **una instalación nueva de Claude Code**
(máquina distinta, o un reset completo de `~/.claude/` como parte del alta en
la otra organización), entonces todo lo de la fila "Global a la máquina" hay
que reconstruirlo, y conviene hacer un respaldo de memoria/historial antes de
perder acceso a la instalación vieja.

---

## ⚠️ Antes de nada: no copies `~/.claude/settings.json` tal cual

Ese archivo contiene, además de configuración legítima para copiar (plugins
habilitados, hooks), un **token de autenticación en texto plano** de la
cuenta/entorno actual (`ANTHROPIC_AUTH_TOKEN` y el `ANTHROPIC_BASE_URL` de un
proxy local). Si copias este archivo completo a la cuenta nueva:

- Ese token seguirá siendo el de la cuenta/entorno viejo — no sirve para
  autenticar la cuenta nueva, y seguir usándolo puede causar comportamiento
  raro o errores de permisos.
- Si el archivo llega a compartirse o subirse a algún repo por error, es una
  fuga de credencial real.

**Qué hacer en vez de copiarlo:** en la cuenta nueva, deja que Claude Code
genere su propio `settings.json` (lo hace solo al autenticar), y de ahí copia
a mano solo lo que quieras preservar: `enabledPlugins`,
`extraKnownMarketplaces`, hooks personalizados — nunca la sección `env` con
tokens.

---

## Checklist de migración

### 1. Memoria y proyecto (debería ser automático)

- [ ] Confirma que sigues trabajando desde la misma ruta local:
      `/Users/xaviercabrera/Claude/taskflow-kanban-prototype` (o la ruta
      equivalente si cambiaste de máquina).
- [ ] En la cuenta nueva, abre una sesión de Claude Code en esa ruta y
      pregunta algo que solo la memoria conocería (p. ej. "¿qué proyecto de
      Supabase usa TaskFlow?" — la respuesta correcta hoy es
      `txdyijyswpsalqnwfopc`). Si responde bien, la memoria persistió.
- [ ] Si vas a cambiar de máquina, copia `~/.claude/projects/<slug>/memory/`
      completo antes de perder acceso a la instalación vieja. El slug se
      deriva de la ruta absoluta del proyecto (en este caso
      `-Users-xaviercabrera-Claude`, porque el proyecto vive bajo
      `/Users/xaviercabrera/Claude/`).

### 2. Configuración del repo (viaja sola con git)

- [ ] `CLAUDE.md`, `AGENTS.md`, `.claude/launch.json`, `.agents/skills/` ya
      están en el repo — un `git clone`/`git pull` en la cuenta nueva los
      trae automáticamente. No requiere acción.
- [ ] Si tienes archivos locales NO versionados dentro de `.claude/` (por
      ejemplo `.claude/settings.local.json` con permisos o hooks personales
      que no quieres commitear), cópialos a mano — `git` no los mueve.

### 3. Conexiones MCP / integraciones externas (requiere reconexión manual)

Estas son cuentas/conectores autenticados por OAuth bajo tu cuenta de Claude
actual. **Van a pedir reconexión en la cuenta nueva** — no hay forma de
transferirlas automáticamente porque el token vive del lado del proveedor,
atado a esa cuenta específica:

- Conectores de claude.ai (ej. HubSpot, Supermetrics, Docusign, y cualquier
  otro que hayas conectado desde la configuración de claude.ai)
- Plugins MCP con OAuth propio usados en este proyecto: **Vercel**, **Figma**,
  **GitHub**, **Slack**, **Neon**, **Linear**, y los que tengas habilitados
  del resto de tu lista de plugins
- Las credenciales de **Supabase** que usa este proyecto específicamente
  (`mcp__supabase__*`) — revisa si tu conexión es por API key de proyecto
  (portátil, no depende de tu cuenta de Claude) o por OAuth de tu cuenta
  personal de Supabase (si es lo segundo, necesitas que la cuenta nueva tenga
  acceso al proyecto Supabase `txdyijyswpsalqnwfopc`, ver `MIGRACION.md`)

Verifica el estado real en cualquier momento pidiéndole a Claude Code que
liste tus conexiones MCP, o abriendo `/mcp` en una sesión interactiva.

### 4. Contexto de esta conversación específica

- [ ] El historial de esta sesión (todo lo hablado hoy sobre importación de
      tareas, el bug del BOM, la documentación, etc.) vive en un archivo
      local de transcripción, no en un servidor atado a tu cuenta — debería
      seguir accesible si sigues en la misma máquina.
- [ ] Como respaldo adicional (recomendado siempre, cambies de cuenta o no):
      pide a Claude, antes de cambiar de cuenta, que te resuma el estado
      actual del proyecto en un archivo — así tienes contexto legible aunque
      algo falle en la transición. (El skill wizard puede generarlo por ti.)

### 5. Verificación final

- [ ] Corre en la cuenta nueva: `git remote -v` (debe seguir apuntando a
      `xaviercabrerau/taskflow-kanban-prototype` o al repo que corresponda).
- [ ] Confirma acceso de escritura al repo (un `git push` de prueba, o
      revisa permisos en GitHub) — si la cuenta nueva es de otra
      organización, probablemente necesites que te inviten como colaborador
      al repo por separado; esto es un permiso de GitHub, no de Claude.
- [ ] Confirma que las variables de entorno de Vercel/Supabase siguen
      accesibles (ver `MIGRACION.md` para el detalle completo de esa parte).

---

## Preguntas que el wizard te va a hacer

El skill en `.agents/skills/migracion-cuenta-claude/SKILL.md` recorre este
checklist de forma interactiva y, entre otras cosas, te preguntará:

1. ¿Sigues en la misma máquina o es una instalación nueva?
2. ¿Confirmas que la memoria del proyecto respondió correctamente a la
   pregunta de verificación?
3. ¿Qué integraciones MCP necesitas reconectar hoy mismo vs. cuáles pueden
   esperar a que las uses?
4. ¿Quieres que genere un resumen de contexto de la sesión actual como
   respaldo antes de cerrar?
5. ¿Tienes acceso de colaborador al repo de GitHub desde la cuenta nueva?

Si alguna respuesta indica un caso no cubierto aquí (por ejemplo, que la
memoria NO respondió correctamente), el wizard te dice qué archivo revisar y
no continúa a ciegas.
