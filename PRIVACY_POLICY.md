> **AVISO IMPORTANTE — ESTE ES UN BORRADOR, NO ES ASESORÍA LEGAL**
>
> Este documento fue redactado por un asistente de IA a partir del código real de TaskFlow, como **punto de partida** para que un abogado lo revise antes de publicarlo. **No es un documento legal final, no ha sido revisado por un profesional del derecho, y no debe usarse en producción ni mostrarse a usuarios reales sin revisión legal previa.** Contiene marcadores de posición (`[entre corchetes]`) y una sección específica que señala qué falta resolver si TaskFlow atiende a usuarios de la Unión Europea (GDPR).

# Política de Privacidad de TaskFlow

**Última actualización:** 2026-08-11
**Versión:** Borrador para revisión legal

## 1. Alcance

Esta política describe cómo CONTO ("TaskFlow", "nosotros") trata los datos personales al operar TaskFlow, una aplicación de gestión de proyectos y tableros Kanban multi-tenant. TaskFlow es un producto **B2B / B2B2C**: nuestros clientes son organizaciones que invitan a sus propios miembros; no recolectamos datos del público general fuera de ese flujo de invitación.

Contacto para temas de privacidad: info@conto.ec.

## 2. Qué datos personales tratamos

| Categoría de datos | Ejemplos concretos | Origen |
|---|---|---|
| Datos de cuenta | Correo electrónico, nombre completo | Gestionados por Supabase Auth al registrarte o al aceptar una invitación |
| Contenido de tareas | Títulos, descripciones, comentarios, adjuntos, posición en el tablero | Introducidos por ti o tus compañeros de organización |
| Registro de auditoría | Acción realizada, tipo/ID de recurso afectado, identificador del actor (o "Sistema" si es automatizado), fuente de la acción, fecha/hora | Generado automáticamente por el sistema en cada acción relevante dentro del workspace |
| Metadatos de sesión/seguridad | Nivel de verificación en dos pasos (AAL) de tu sesión, si tienes un factor MFA verificado | Gestionado directamente por Supabase Auth |
| Datos de verificación en dos pasos (MFA) | Secreto TOTP, códigos de verificación | **Gestionados íntegramente por Supabase Auth. La base de datos propia de TaskFlow nunca almacena ni tiene acceso al secreto TOTP** — solo se consulta si existe un factor verificado. |
| Configuración de integraciones | Qué proveedores de terceros tiene activos tu organización, campos de configuración no sensibles (por ejemplo, un correo remitente) | Introducidos por el propietario de la organización |
| Credenciales de integraciones | API keys, tokens, secretos de webhook de integraciones de terceros | **Cifrados en Supabase Vault; nunca se almacenan en texto plano ni se devuelven al cliente.** La aplicación solo sabe si existe o no una credencial guardada, nunca su valor. |
| Tokens de acceso MCP | Nombre del token, cliente asociado (ej. "Claude Desktop"), fecha de creación, fecha de último uso | Generados voluntariamente por cada usuario |

**No recolectamos** datos de navegación con fines publicitarios ni usamos cookies de rastreo/analítica de terceros: al día de esta versión, el producto no integra ningún proveedor de publicidad ni analítica de ese tipo.

## 3. Para qué usamos estos datos

- **Prestar el servicio:** mostrar y sincronizar tableros, tareas, comentarios y notificaciones dentro de tu organización.
- **Seguridad y auditoría:** mantener un registro de auditoría de acciones relevantes (quién hizo qué y cuándo) para que cada organización pueda detectar actividad indebida y cumplir sus propios requisitos internos de trazabilidad.
- **Verificación en dos pasos:** si tu organización lo exige, verificar tu identidad en cada inicio de sesión mediante un código TOTP, antes de conceder acceso a los datos del workspace.
- **Notificaciones:** avisarte de cambios relevantes en tareas que te involucran (asignaciones, menciones, vencimientos, etc.), dentro de la propia aplicación y, si tu organización configuró correo transaccional, también por correo.
- **Soporte de integraciones que tu organización decide activar** (ver sección 4).

No usamos tus datos para entrenar modelos de IA propios ni los vendemos a terceros.

## 4. Con quién compartimos datos (y por qué)

### 4.1 Proveedores de infraestructura (necesarios para operar el servicio)

- **Supabase**: proveedor de base de datos, autenticación y almacenamiento. Todos los datos descritos en la sección 2 residen en la infraestructura de Supabase. Supabase puede a su vez depender de infraestructura de AWS. **[Pendiente de confirmar con Supabase/el equipo de infraestructura: región(es) de datos exactas y lista de subprocesadores vigente, a incluir aquí antes de publicar.]**
- **Vercel**: proveedor de hosting de la aplicación web (frontend y funciones de servidor).

Estos proveedores actúan como encargados/subprocesadores de tratamiento y no usan los datos de TaskFlow para fines propios.

### 4.2 Proveedores que tu organización activa voluntariamente

- **Resend (correo transaccional):** cada organización que activa esta integración lo hace con **su propia cuenta y API key de Resend**. En ese caso, el remitente efectivo de los correos de notificación de esa organización es la cuenta de Resend de la propia organización, no una cuenta centralizada de TaskFlow. Si tu organización no activa esta integración, no se comparte contenido con Resend.
- **Otras integraciones opcionales** (Slack, Microsoft Teams, Zoom, n8n, GitHub, OpenAI, Anthropic vía integración de organización): solo se activan si el propietario de tu organización las configura explícitamente, y solo se comparte el contenido necesario para esa integración concreta (por ejemplo, un mensaje de notificación enviado a un webhook de Slack).
- **"Gmail (entrada)" no está activa:** esta integración aparece en el panel de integraciones pero **no está operativa** en este momento — el endpoint asociado responde que no está configurado, y activarla realmente requeriría que un administrador configure OAuth y Google Cloud Pub/Sub fuera de la aplicación. No se envían ni reciben datos reales a través de Gmail mientras esto no ocurra.

### 4.3 Agentes de IA conectados por decisión del propio usuario (tokens MCP)

TaskFlow permite que **cada usuario, individualmente**, genere un token de acceso personal para conectar un agente de IA (por ejemplo, un cliente de Claude) al workspace mediante un endpoint MCP. Si haces esto:

- El agente de IA que conectaste podrá leer y, según el alcance del token, escribir tareas y comentarios en tu nombre.
- Ese contenido puede ser enviado al proveedor de IA correspondiente (por ejemplo, Anthropic) y tratado conforme a las políticas de privacidad de ese proveedor externo.
- **Esta compartición de datos es siempre iniciada por decisión explícita del usuario que genera y conecta el token — TaskFlow no envía datos a ningún proveedor de IA de forma automática o por decisión propia.**
- Puedes revocar el token en cualquier momento, lo que corta inmediatamente ese acceso.
- Además del control individual por token, el propietario de la organización puede **desactivar la creación de tokens MCP para toda la organización** desde la configuración de seguridad; al hacerlo, los tokens existentes dejan de funcionar de inmediato, no solo los nuevos.

Recomendamos a cada organización evaluar internamente qué tipo de contenido es apropiado exponer de esta manera, especialmente si las tareas contienen datos personales de terceros (por ejemplo, de clientes finales) o información confidencial.

## 5. Cuánto tiempo conservamos los datos

- **Contenido de tareas y comentarios:** se conserva mientras la organización no lo elimine. Si se elimina una tarea, un tablero o la organización completa, el contenido correspondiente se elimina según los procesos de borrado del producto.
- **Registro de auditoría:** cada organización configura su propio período de retención (por defecto 90 días, configurable entre 30 y 3650 días desde el panel de auditoría). Las entradas más antiguas que ese período se **eliminan automáticamente cada noche mediante un proceso programado**, sin intervención manual.
- **Factores MFA:** se conservan en Supabase Auth hasta que el usuario los elimine desde su configuración de seguridad.
- **Tokens MCP:** permanecen visibles (como revocados o activos) en el listado de la organización; un token revocado deja de funcionar de inmediato pero su registro histórico (nombre, fechas) puede conservarse para trazabilidad.

## 6. Medidas de seguridad

- **Aislamiento multi-tenant mediante Row Level Security (RLS):** los datos de cada organización están segmentados a nivel de base de datos, de modo que una organización no puede acceder a los datos de otra a través del uso normal de la aplicación.
- **Verificación en dos pasos (MFA) configurable por organización:** el propietario puede exigir MFA a todos los miembros; sin un factor verificado, el acceso al workspace se bloquea.
- **Secretos nunca en texto plano:** tanto las credenciales de integraciones de terceros como los secretos TOTP se gestionan mediante mecanismos cifrados (Supabase Vault para integraciones; Supabase Auth internamente para MFA) — la base de datos de la aplicación nunca almacena ni expone estos valores en claro.
- **Mensajes de error controlados:** los endpoints que exponen funciones sensibles (como el endpoint MCP) devuelven mensajes de error genéricos al cliente, evitando filtrar detalles internos del esquema de base de datos.
- **Tokens de un solo vistazo:** los tokens de acceso personal (MCP) se muestran una única vez al crearse y no pueden recuperarse después, solo revocarse.

[El equipo legal/de seguridad debe evaluar si se requiere describir aquí medidas adicionales — cifrado en tránsito/reposo a nivel de infraestructura, políticas de contraseñas, pruebas de penetración, certificaciones, etc. — antes de publicar.]

## 7. Tus derechos

Dependiendo de tu rol y de la legislación aplicable, puedes tener derecho a acceder, corregir, exportar o solicitar la eliminación de tus datos personales:

- **Acceso y exportación:** los propietarios de organización pueden exportar el registro de auditoría en formato CSV para un rango de fechas determinado, como mecanismo concreto de acceso y trazabilidad ya disponible en el producto.
- **Corrección:** puedes actualizar tu nombre y otros datos de perfil directamente en la aplicación.
- **Eliminación:** puedes solicitar la eliminación de tu cuenta o de los datos de tu organización escribiendo a info@conto.ec. [El equipo legal debe definir el procedimiento formal, plazos de respuesta, y excepciones — por ejemplo, datos que deban conservarse por obligación legal.]
- **Revocar accesos de terceros:** puedes desactivar integraciones o revocar tokens MCP en cualquier momento desde los paneles correspondientes, cortando de inmediato ese flujo de datos.

## 8. Usuarios en la Unión Europea (GDPR) — pendiente de revisión legal

**[Marcador de posición importante.]** Si TaskFlow presta servicio a organizaciones o usuarios ubicados en la Unión Europea, esta política **requiere trabajo adicional de un abogado especializado en protección de datos** antes de publicarse, incluyendo como mínimo:

- Identificar la **base legal** (art. 6 GDPR) aplicable a cada categoría de datos de la sección 2 (por ejemplo, ejecución de contrato para el contenido de tareas, interés legítimo o obligación legal para el registro de auditoría).
- Formalizar **Acuerdos de Procesamiento de Datos (DPA)** con cada subprocesador relevante (Supabase, Vercel, y — cuando la propia organización cliente los active — Resend y otros proveedores de integración).
- Confirmar mecanismos de **transferencia internacional de datos** si el almacenamiento ocurre fuera del Espacio Económico Europeo (depende de la región de datos de Supabase, ver sección 4.1, aún sin confirmar).
- Evaluar si corresponde una **Evaluación de Impacto (DPIA)**, dado el tratamiento de registros de auditoría con metadatos de actor y la función de conexión voluntaria a agentes de IA de terceros.
- Definir el proceso formal para ejercer los derechos GDPR (acceso, rectificación, supresión, portabilidad, oposición) más allá de los mecanismos de producto ya existentes descritos en la sección 7.

## 9. Cambios a esta política

Podemos actualizar esta Política de Privacidad periódicamente. Notificaremos cambios materiales a los propietarios de organización con [plazo a definir] de antelación.

## 10. Contacto

Para preguntas sobre esta política o para ejercer tus derechos: info@conto.ec.
