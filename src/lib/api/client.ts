/**
 * Cliente API para crear registros vía endpoints REST.
 * Usa la sesión del usuario (cookies) para autenticación.
 */

async function apiPost<T>(path: string, data: Record<string, unknown>): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) {
    return { success: false, error: json?.error ?? `Error ${res.status}` };
  }
  return json as { success: true; data: T };
}

export async function apiCreateCliente(data: {
  tipo_cliente?: string;
  empresa?: string;
  nombre_contacto: string;
  ruc?: string;
  documento?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  ciudad?: string;
  pais?: string;
  condicion_pago?: string;
  moneda_preferida?: string;
  estado?: string;
}): Promise<{ id: string; [key: string]: unknown } | null> {
  const result = await apiPost<{ id: string; [key: string]: unknown }>("/api/clientes", data);
  return result.success ? result.data : null;
}

export async function apiCreateFactura(data: {
  cliente_id: string;
  numero_factura: string;
  fecha: string;
  fecha_vencimiento: string;
  monto: number;
  tipo?: string;
  moneda?: string;
}): Promise<{ id: string; [key: string]: unknown } | null> {
  const result = await apiPost<{ id: string; [key: string]: unknown }>("/api/facturas", data);
  return result.success ? result.data : null;
}

export async function apiCreatePago(data: {
  factura_id: string;
  monto: number;
  fecha_pago: string;
  metodo_pago?: string;
  referencia?: string;
}): Promise<{ id: string; [key: string]: unknown } | null> {
  const result = await apiPost<{ id: string; [key: string]: unknown }>("/api/pagos", data);
  return result.success ? result.data : null;
}

export async function apiCreateSuscripcion(data: {
  cliente_id: string;
  plan_id?: string | null;
  precio: number;
  moneda?: string;
  fecha_inicio: string;
  duracion_meses?: number;
  dia_facturacion?: number;
  dia_vencimiento?: number;
  generar_factura_este_mes?: boolean;
}): Promise<{ id: string; [key: string]: unknown } | null> {
  const result = await apiPost<{ id: string; [key: string]: unknown }>("/api/suscripciones", data);
  return result.success ? result.data : null;
}
