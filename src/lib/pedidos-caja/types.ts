/**
 * Tipos del modulo Consulta / pedidos a caja.
 *
 * Un pedido_caja es un carrito armado por un vendedor desde /consulta que
 * espera a que el cajero lo cobre en /ventas/nueva. Cuando se cobra, queda
 * 'facturado' y vinculado a la venta resultante.
 */

export type EstadoPedidoCaja = "pendiente" | "facturado" | "cancelado";

export interface PedidoCajaItem {
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_venta: number;
  tipo_precio: "minorista" | "mayorista" | "distribuidor";
  // Presentacion opcional (Caja, Paquete...). Snapshot al momento del pedido.
  presentacion_id?: string | null;
  presentacion_nombre?: string | null;
  presentacion_cantidad_base?: number | null;
}

export interface PedidoCaja {
  id: string;
  titulo: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  observacion: string | null;
  items: PedidoCajaItem[];
  total_estimado: number;
  estado: EstadoPedidoCaja;
  venta_id: string | null;
  venta_numero: string | null;
  armado_por_id: string | null;
  armado_por_email: string | null;
  created_at: string;
  facturado_at: string | null;
  cancelado_at: string | null;
  cancelado_motivo: string | null;
}
