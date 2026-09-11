---
name: migracion-cuenta-claude
description: Wizard interactivo para verificar que el cambio a una cuenta de Claude nueva (u organización nueva) no rompió nada al seguir trabajando en el proyecto TaskFlow — memoria, historial de sesión, conexiones MCP, acceso al repo. Úsalo cuando el usuario diga cosas como "cambié de cuenta de Claude", "usa el skill de migración de cuenta", o "verifica que la migración de cuenta funcionó".
---

# Migración de cuenta de Claude — wizard

Referencia completa: [`../../../MIGRACION_CUENTA_CLAUDE.md`](../../../MIGRACION_CUENTA_CLAUDE.md).
Este skill NO reemplaza esa guía — la recorre de forma interactiva,
verificando cada punto en vez de asumirlo.

**Regla dura:** no marques ningún ítem como resuelto sin verificarlo de
verdad (leer un archivo, correr un comando, o una respuesta explícita del
usuario). Si algo falla, dilo y detente en ese punto — no sigas al siguiente
paso "optimista".

**Nunca** imprimas, cites, o escribas en ningún archivo el valor de
`ANTHROPIC_AUTH_TOKEN` ni de ningún otro token/secreto que veas al inspeccionar
`~/.claude/settings.json` u otros archivos de configuración. Solo confirma si
existen o no.

## Paso 0: Entender el escenario

Pregunta (una por una, no todas juntas):

1. "¿Sigues trabajando en la misma máquina, o esto es una instalación nueva
   de Claude Code en otra computadora?"
2. "¿Ya iniciaste sesión con la cuenta nueva, o todavía estás en la cuenta
   vieja preparando el cambio?"

Si el usuario todavía está en la cuenta vieja preparando el cambio: salta al
"Paso 5: Respaldo preventivo" primero, antes de que pierda acceso a nada.

Si ya está en la cuenta nueva: continúa con el Paso 1.

## Paso 1: Verificar memoria del proyecto

1. Lee `MEMORY.md` de la memoria de este proyecto (el índice de memoria
   auto-cargado al inicio de la sesión).
2. Si el índice está vacío o no existe, dilo explícitamente: "La memoria del
   proyecto no cargó — esto es esperable si cambiaste de máquina y no
   copiaste `~/.claude/projects/<slug>/memory/`. Ver la sección 1 de
   `MIGRACION_CUENTA_CLAUDE.md`." y detente aquí, ofreciendo ayudar a
   localizar el respaldo si el usuario lo tiene.
3. Si el índice sí cargó, haz la pregunta de verificación al usuario: "Para
   confirmar que la memoria persistió correctamente, ¿puedes decirme (sin
   que yo te lo diga primero) qué base de datos usa TaskFlow?" — espera su
   respuesta y compárala con lo que dice tu propia memoria cargada (debe
   mencionar Supabase / el project ref `txdyijyswpsalqnwfopc`). Repórtale si
   coincide.

## Paso 2: Verificar historial de sesión

1. Pregunta: "¿Puedes ver en tu terminal/cliente el historial de
   conversaciones anteriores de este proyecto (sesiones pasadas), o la
   lista aparece vacía?"
2. Si aparece vacío pero la memoria del Paso 1 sí cargó: explica que son
   mecanismos distintos (memoria vs. transcripciones de sesión) y que puede
   ser normal si el cliente que está usando ahora indexa sesiones de forma
   distinta — no es necesariamente un problema, pero anótalo como algo a
   confirmar con quien administre su instalación de Claude Code.
3. Si el usuario quiere un respaldo de contexto igual (recomendado siempre):
   ofrece generar un resumen fechado del estado actual del proyecto (ver
   Paso 5).

## Paso 3: Verificar conexiones MCP / integraciones

1. Dile al usuario: "Voy a intentar usar algunas de las integraciones que
   este proyecto necesita para ver cuáles piden reconexión."
2. Intenta una operación de lectura simple contra **Supabase** (por ejemplo,
   listar tablas o el proyecto activo). Si falla por auth, repórtalo como
   "Supabase: necesita reconexión" y explica que el usuario debe re-autorizar
   esa conexión desde su cliente de Claude, y confirmar que la cuenta nueva
   tiene acceso al proyecto `txdyijyswpsalqnwfopc` (ver `MIGRACION.md`).
3. Repite la idea para cualquier otra integración que el usuario mencione
   que necesita HOY (no intentes probarlas todas si no las va a usar de
   inmediato — pregúntale primero: "¿qué integraciones necesitas funcionando
   hoy mismo: GitHub, Vercel, Slack, alguna otra?" y solo verifica esas).
4. Para cada una que falle, dale la instrucción concreta: reconectar desde
   la configuración de MCP de su cliente (`/mcp` en modo interactivo, o la
   sección de conectores de claude.ai si es un conector de claude.ai).

## Paso 4: Verificar acceso al repositorio

1. Corre (con permiso del usuario) `git remote -v` en el directorio del
   proyecto y confirma que apunta al repo esperado.
2. Pregunta: "¿Tu cuenta nueva de GitHub/organización ya tiene acceso de
   colaborador a este repositorio, o hay que gestionarlo?" — esto es un
   permiso de GitHub, no algo que Claude pueda resolver por sí solo.
3. Si el usuario lo confirma, opcionalmente valida con un comando de
   solo-lectura como `git fetch` (nunca fuerces un push de prueba sin que lo
   pida explícitamente).

## Paso 5: Respaldo preventivo (opcional, pero ofrécelo siempre)

Pregunta: "¿Quieres que genere un resumen fechado del estado actual del
proyecto — en qué quedó el último trabajo, qué está pendiente — como
respaldo de contexto, por si algo se pierde en la transición?"

Si dice que sí: escribe un archivo `RESUMEN_SESION_<YYYY-MM-DD>.md` (en la
raíz del repo, o donde el usuario prefiera) con:
- Fecha y qué se hizo en la sesión más reciente
- Estado del proyecto (rama activa, últimos commits relevantes, si hay
  trabajo sin commitear)
- Cualquier decisión o pendiente abierto que no esté ya en la memoria o en
  la documentación del repo

No dupliques contenido que ya viva en `MEMORY.md` o en los docs del
proyecto — enlázalos en vez de copiarlos.

## Cierre

Al final, resume en una tabla simple qué quedó verificado (✅), qué quedó
pendiente de acción manual del usuario (⚠️, con la acción concreta), y qué
no se pudo verificar en esta sesión (❓). No declares la migración
"completa" si queda algún ⚠️ o ❓ sin que el usuario los reconozca
explícitamente como aceptables por ahora.
