import { getRequestId } from "@/lib/tracing/request-context";

/**
 * Logger que integra automáticamente request IDs
 * Auto-registra errores en ErrorTracker cuando se invoca logger.error()
 * Proporciona degradación graciosa si no hay contexto de request
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Formatea una entrada de log
 */
function formatLogEntry(
  level: LogLevel,
  message: string,
  additionalData?: Record<string, unknown>
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  // Agregar requestId si está disponible (degradación graciosa)
  const requestId = getRequestId();
  if (requestId) {
    entry.requestId = requestId;
  }

  // Agregar datos adicionales
  if (additionalData) {
    Object.assign(entry, additionalData);
  }

  return entry;
}

/**
 * Logger simple con soporte para request IDs
 */
class Logger {
  private isDevelopment = process.env.NODE_ENV === "development";

  /**
   * Log a nivel DEBUG
   */
  debug(message: string, data?: Record<string, unknown>) {
    if (this.isDevelopment) {
      const entry = formatLogEntry("debug", message, data);
      console.debug(JSON.stringify(entry));
    }
  }

  /**
   * Log a nivel INFO
   */
  info(message: string, data?: Record<string, unknown>) {
    const entry = formatLogEntry("info", message, data);
    console.info(JSON.stringify(entry));
  }

  /**
   * Log a nivel WARN
   */
  warn(message: string, data?: Record<string, unknown>) {
    const entry = formatLogEntry("warn", message, data);
    console.warn(JSON.stringify(entry));
  }

  /**
   * Log a nivel ERROR
   */
  error(message: string, error?: unknown, data?: Record<string, unknown>) {
    const additionalData = data || {};

    // Extraer información del error si es proporcionado
    if (error instanceof Error) {
      additionalData.errorName = error.name;
      additionalData.errorMessage = error.message;
      additionalData.errorStack = error.stack;
    } else if (error) {
      additionalData.error = String(error);
    }

    const entry = formatLogEntry("error", message, additionalData);
    console.error(JSON.stringify(entry));
  }
}

export const logger = new Logger();

export default logger;
