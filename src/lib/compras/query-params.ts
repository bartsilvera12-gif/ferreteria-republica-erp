/** Lectura de los filtros de compras desde el query string. Compartido por el listado y el export. */

/** `?clave=YYYY-MM-DD`; null si falta o el formato no es valido. */
export function fechaParam(sp: URLSearchParams, clave: string): string | null {
  const raw = sp.get(clave)?.trim();
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** `?tipo_pago=contado|credito`; null para cualquier otro valor. */
export function tipoPagoParam(sp: URLSearchParams): "contado" | "credito" | null {
  const raw = sp.get("tipo_pago")?.trim();
  return raw === "contado" || raw === "credito" ? raw : null;
}
