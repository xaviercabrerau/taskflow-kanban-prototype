> **AVISO IMPORTANTE — ESTE ES UN BORRADOR, NO ES ASESORÍA LEGAL**
>
> Este documento fue redactado por un asistente de IA a partir del código real de TaskFlow, como **punto de partida** para que un abogado lo revise antes de publicarlo. **No es un documento legal final, no ha sido revisado por un profesional del derecho, y no debe usarse en producción ni mostrarse a usuarios reales sin revisión legal previa.** Contiene marcadores de posición (`[entre corchetes]`) que deben completarse, y secciones que requieren decisiones legales específicas del equipo (por ejemplo, límites de responsabilidad y jurisdicción aplicable).

# Términos de Servicio de TaskFlow

**Última actualización:** 2026-08-11
**Versión:** Borrador para revisión legal

## 1. Quiénes somos y qué es TaskFlow

TaskFlow es una aplicación de gestión de proyectos y tableros Kanban, operada por CONTO ("TaskFlow", "nosotros"), con domicilio en Puerto Santa Ana, Edificio The Point, Guayaquil, Ecuador. Puedes contactarnos en info@conto.ec.

TaskFlow es un servicio **multi-tenant**: cada organización que se registra ("tu organización", "tu workspace") tiene su propio espacio aislado de datos (tableros, tareas, comentarios, miembros, registros de auditoría, etc.), separado técnicamente del de otras organizaciones mediante controles de acceso a nivel de base de datos (Row Level Security).

TaskFlow está pensado para que **organizaciones inviten a sus propios miembros** (equipos, colaboradores, clientes invitados puntualmente). No es una plataforma de acceso público ni recolecta datos de visitantes anónimos fuera del flujo de registro/invitación.

## 2. Creación de cuenta y organización

- Para usar TaskFlow necesitas crear una cuenta de usuario (correo y datos básicos, gestionados a través de Supabase Auth) y pertenecer a al menos una organización.
- Quien crea una organización se convierte en su **propietario ("owner")**. Los propietarios pueden invitar **miembros ("members")** por correo electrónico, asignarles roles personalizados con permisos específicos (lectura/escritura sobre tareas, gestión de integraciones, exportación de auditoría, etc.), y configurar políticas de seguridad de toda la organización, incluyendo si la verificación en dos pasos (MFA) es obligatoria para todos los miembros.
- Cada organización es responsable de la exactitud de la información de sus miembros y del uso que estos hagan de la cuenta, dentro de los límites de estos Términos.
- Debes proporcionar información veraz al registrarte y eres responsable de mantener la confidencialidad de tus credenciales y de cualquier token de acceso personal que generes (ver sección 5).

## 3. Uso aceptable

Al usar TaskFlow te comprometes a no:

- Usar el servicio para almacenar o transmitir contenido ilegal, difamatorio, o que infrinja derechos de terceros.
- Intentar vulnerar el aislamiento entre organizaciones (multi-tenancy), acceder a datos de otra organización sin autorización, o realizar pruebas de intrusión sin permiso expreso por escrito.
- Usar los tokens de acceso personal (MCP) o las integraciones de terceros para extraer datos de la organización con fines distintos a los previstos por esta o para exponerlos a partes no autorizadas.
- Sobrecargar deliberadamente la infraestructura del servicio (scraping agresivo, automatizaciones abusivas, etc.).
- Revender o sublicenciar el acceso al servicio sin autorización expresa.

[El equipo legal debe revisar y ampliar esta sección según el modelo comercial final (planes, límites de uso, política de contenido, etc.).]

## 4. Capacidad de agentes de IA (tokens MCP) — lectura obligatoria

TaskFlow incluye una función que permite a **cada usuario, de forma individual y voluntaria**, generar un **token de acceso personal** para conectar un agente de inteligencia artificial (por ejemplo, Claude Desktop, Claude Code, u otro cliente compatible con el protocolo MCP) directamente al workspace, a través de un endpoint JSON-RPC dedicado (`/api/mcp`).

Es importante que entiendas exactamente qué implica esto:

- **El token le da al agente de IA acceso real de lectura y escritura** sobre las tareas y comentarios visibles para el usuario que generó el token (listar tareas, crear tareas, moverlas entre columnas, agregar comentarios), según los permisos ("scopes") asociados al token.
- **Esta es una función real y activa del producto**, no una posibilidad hipotética: si generas un token y lo conectas a un agente de IA, ese agente podrá leer y modificar datos de tu organización en tu nombre, y ese contenido (títulos de tareas, comentarios, etc.) podrá ser procesado por el proveedor de IA correspondiente (por ejemplo, Anthropic) conforme a los términos y políticas de privacidad de ese proveedor externo, **no las de TaskFlow**.
- **La generación del token, y la decisión de conectarlo a un agente de IA, es siempre iniciada por el usuario**, nunca por TaskFlow. TaskFlow no envía datos a ningún proveedor de IA por iniciativa propia a través de esta función.
- Los tokens se muestran una sola vez al crearse y pueden revocarse en cualquier momento desde la organización. Eres responsable de proteger tus tokens como si fueran una contraseña, y de revocarlos si sospechas que fueron comprometidos.
- Además del control individual por token, el **propietario de la organización** puede desactivar la creación de tokens MCP para toda la organización desde la configuración correspondiente; al hacerlo, ningún miembro (incluido el propio propietario) puede generar tokens nuevos y los ya emitidos dejan de funcionar de inmediato.
- Cada organización y cada miembro deben evaluar si es apropiado, dado el contenido de sus tareas, conectar un agente de IA externo mediante esta función, especialmente si el contenido de las tareas incluye información confidencial o datos personales de terceros.

## 5. Integraciones de terceros

TaskFlow permite a los propietarios de organización configurar integraciones opcionales con servicios de terceros (por ejemplo, Slack, Microsoft Teams, Zoom, n8n, OpenAI, Anthropic, GitHub, Resend para correo transaccional). Al activar una integración:

- Las credenciales (API keys, tokens, webhooks secretos) se almacenan cifradas mediante Supabase Vault y nunca se guardan ni se muestran en texto plano después de ingresarlas.
- El uso de cada integración implica que cierto contenido de la organización (por ejemplo, notificaciones de tareas) pueda transmitirse al servicio de terceros correspondiente, sujeto a los propios términos de ese proveedor.
- Algunas integraciones listadas en el producto (actualmente, recepción de respuestas por correo vía "Gmail (entrada)") **no están activas ni operativas**: el endpoint correspondiente existe pero devuelve un estado "no configurado" y requiere configuración adicional de OAuth/Google Cloud fuera de la aplicación por parte de un administrador. No debe asumirse que esta integración funciona hasta que se indique expresamente lo contrario.

## 6. Propiedad de los datos

Tu organización es propietaria del contenido que crea en TaskFlow: tareas, comentarios, adjuntos, plantillas, reglas de automatización, y cualquier otro dato generado dentro de su workspace ("Contenido de la Organización"). TaskFlow no reclama propiedad sobre el Contenido de la Organización.

TaskFlow conserva la propiedad del software, la infraestructura, las marcas y cualquier material no generado por los usuarios.

Al usar el servicio, otorgas a TaskFlow una licencia limitada para almacenar, procesar y transmitir el Contenido de la Organización únicamente en la medida necesaria para prestar el servicio (incluyendo copias de seguridad, replicación de la base de datos, y el enrutamiento a integraciones que la propia organización haya activado).

## 7. Terminación

- Puedes dejar de usar el servicio en cualquier momento. Los propietarios de organización pueden solicitar la eliminación de su cuenta y datos.
- TaskFlow puede suspender o terminar cuentas que incumplan estos Términos, incluyendo el uso indebido de tokens MCP o integraciones, tras notificación cuando sea razonablemente posible.
- [El equipo legal debe definir el procedimiento exacto de terminación, plazos de preaviso, y qué ocurre con los datos exportables tras la baja (ver retención en la Política de Privacidad).]

## 8. Limitación de responsabilidad

TaskFlow se ofrece "tal cual" ("as is"). En la medida permitida por la ley aplicable, TaskFlow no será responsable de daños indirectos, incidentales o consecuentes derivados del uso del servicio.

**[El equipo legal debe definir los límites de responsabilidad específicos (topes cuantitativos, exclusiones, garantías mínimas exigidas por ley, tratamiento de fuerza mayor, responsabilidad por fallos de proveedores de infraestructura como Supabase o Vercel, y responsabilidad derivada del uso de la función de agentes de IA descrita en la sección 4) antes de publicar esta sección.]**

## 9. Ley aplicable y jurisdicción

Estos Términos se regirán por las leyes de Ecuador, y cualquier disputa se someterá a los tribunales de Guayaquil, Ecuador. **[El equipo legal debe confirmar esta elección de jurisdicción, incluyendo si aplica algún mecanismo de resolución alternativa de disputas antes de acudir a tribunales.]**

## 10. Cambios a estos Términos

Podemos actualizar estos Términos periódicamente. Notificaremos cambios materiales a los propietarios de organización con [plazo a definir] de antelación. El uso continuado del servicio tras la entrada en vigor de los cambios constituye aceptación de los nuevos Términos.

## 11. Contacto

Para preguntas sobre estos Términos: info@conto.ec.
