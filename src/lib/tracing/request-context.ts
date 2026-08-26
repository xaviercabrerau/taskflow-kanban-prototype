import { AsyncLocalStorage } from "async_hooks";

/**
 * RequestContext para propagar request IDs a través de toda la cadena de ejecución
 * Utiliza AsyncLocalStorage para disponibilidad global en contexto asincrónico
 */

export interface RequestContextData {
  requestId: string;
  timestamp: number;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContextData>();

/**
 * Genera un ID de request único con formato: req_<timestamp>_<random8chars>
 */
export function generateRequestId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `req_${timestamp}_${random}`;
}

/**
 * Obtiene el request ID actual del contexto
 * Si no hay contexto, retorna undefined (degradación graciosa)
 */
export function getRequestId(): string | undefined {
  const store = asyncLocalStorage.getStore();
  return store?.requestId;
}

/**
 * Almacena el request context para disponibilidad global
 */
export function setRequestContext(requestId: string, callback: () => Promise<void> | void) {
  const data: RequestContextData = {
    requestId,
    timestamp: Date.now(),
  };
  return asyncLocalStorage.run(data, callback);
}

/**
 * Obtiene el contexto completo (para debugging)
 */
export function getRequestContext(): RequestContextData | undefined {
  return asyncLocalStorage.getStore();
}
