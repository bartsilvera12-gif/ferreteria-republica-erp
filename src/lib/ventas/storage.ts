import type { Venta } from "./types";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/** Un faltante de stock devuelto por el backend (409) para el modal de confirmación. */
export type FaltanteStock = {
  tipo: "producto" | "insumo";
  producto_id: string;
  nombre: string;
  sku: string;
  stock_actual: number;
  solicitado: number;
  faltante: number;
  /** true = producto con controla_stock: no se puede vender sin stock. */
  bloqueante?: boolean;
};

export type ResultadoGuardarVenta =
  | { success: true; venta: Venta }
  | { success: false; error: string; faltantes?: FaltanteStock[] };

/** Modalidad del pedido (instancia gastronómica En lo de Mari). */
export type PedidoCocinaInput = {
  modalidad: "local" | "delivery" | "carry_out";
  mesa?: string | null;
  cliente_nombre?: string | null;
  cliente_telefono?: string | null;
  direccion_entrega?: string | null;
  observacion?: string | null;
};

/** Detalle de cobro (conciliación bancaria) — opcional, 1 por venta. */
export type PagoDetalleInput = {
  entidad_bancaria_id?: string | null;
  entidad_nombre_snapshot?: string | null;
  /** Monto del pago por este medio. Si no viene, el backend usa el total. */
  monto?: number | null;
  referencia?: string | null;
  titular?: string | null;
  observacion?: string | null;
  fecha_acreditacion?: string | null;
};

/** Una línea de un cobro MIXTO (varios medios para una misma venta). */
export type PagoLineaInput = {
  metodo_pago: "efectivo" | "transferencia" | "tarjeta";
  monto: number;
  entidad_bancaria_id?: string | null;
  entidad_nombre_snapshot?: string | null;
  referencia?: string | null;
  titular?: string | null;
};

export type FiltrosVentas = {
  page: number;
  limit: number;
  q?: string;
  tipo?: string;
  iva?: string;
};

export type PaginaVentas = {
  ventas: Venta[];
  /** Total de ventas que cumplen los filtros. */
  total: number;
  /** Total de ventas del tenant, sin filtros. */
  total_general: number;
};

/**
 * Lista una página de ventas del tenant (paginación, búsqueda y filtros server-side).
 * Devuelve `null` si falló la carga.
 */
export async function getVentasPagina(f: FiltrosVentas): Promise<PaginaVentas | null> {
  try {
    const params = new URLSearchParams({ page: String(f.page), limit: String(f.limit) });
    if (f.q?.trim()) params.set("q", f.q.trim());
    if (f.tipo) params.set("tipo", f.tipo);
    if (f.iva) params.set("iva", f.iva);
    const res = await fetchWithSupabaseSession(`/api/ventas?${params.toString()}`, { cache: "no-store" });
    const json = (await res.json()) as {
      success?: boolean;
      data?: Partial<PaginaVentas>;
      error?: string;
    };
    if (!res.ok || !json.success || !json.data?.ventas) {
      console.error("[ventas] getVentasPagina:", json.error ?? res.statusText);
      return null;
    }
    return {
      ventas: json.data.ventas,
      total: Number(json.data.total ?? json.data.ventas.length),
      total_general: Number(json.data.total_general ?? json.data.total ?? 0),
    };
  } catch (e) {
    console.error("[ventas] getVentasPagina:", e);
    return null;
  }
}

/**
 * Crea una venta en base de datos (transacción servidor: ítems, stock, movimientos).
 */
export async function saveVenta(
  datos: Omit<Venta, "id" | "numero_control" | "fecha"> & { cliente_id?: string | null; genera_nota_remision?: boolean },
  pedidoCocina?: PedidoCocinaInput,
  pagoDetalle?: PagoDetalleInput | null,
  opts?: {
    permitirSinStock?: boolean;
    pedidoId?: string | null;
    pedidoCajaId?: string | null;
    cajaId?: string | null;
    /** Monto del saldo a favor del cliente que se aplica a esta venta. */
    usarSaldoFavor?: number;
    /** Excedente de saldo que el cliente pide retirar en efectivo. */
    retirarSaldoEfectivo?: number;
    /** Cobro mixto: varias líneas de pago que suman el total a cobrar. */
    pagos?: PagoLineaInput[] | null;
  }
): Promise<ResultadoGuardarVenta> {
  if (!datos.items || datos.items.length === 0) {
    return { success: false, error: "La venta debe tener al menos un producto." };
  }

  try {
    const res = await fetchWithSupabaseSession("/api/ventas/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: datos.items,
        moneda: datos.moneda,
        tipo_cambio: datos.tipo_cambio,
        subtotal: datos.subtotal,
        monto_iva: datos.monto_iva,
        total: datos.total,
        tipo_venta: datos.tipo_venta,
        plazo_dias: datos.plazo_dias,
        metodo_pago: datos.metodo_pago,
        cliente_id: datos.cliente_id ?? null,
        observaciones: null,
        pedido_cocina: pedidoCocina ?? null,
        pago_detalle: pagoDetalle ?? null,
        pagos: opts?.pagos && opts.pagos.length > 0 ? opts.pagos : null,
        permitir_sin_stock: opts?.permitirSinStock === true,
        genera_nota_remision: datos.genera_nota_remision === true,
        pedido_id: opts?.pedidoId ?? null,
        pedido_caja_id: opts?.pedidoCajaId ?? null,
        caja_id: opts?.cajaId ?? null,
        usar_saldo_favor: opts?.usarSaldoFavor ?? 0,
        retirar_saldo_efectivo: opts?.retirarSaldoEfectivo ?? 0,
      }),
    });

    const json = (await res.json()) as {
      success?: boolean;
      data?: { venta?: Venta };
      error?: string;
      faltantes?: FaltanteStock[];
    };

    if (!res.ok || !json.success || !json.data?.venta) {
      return {
        success: false,
        error: json.error ?? `No se pudo registrar la venta (${res.status}).`,
        faltantes: Array.isArray(json.faltantes) ? json.faltantes : undefined,
      };
    }

    return { success: true, venta: json.data.venta };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de red.";
    return { success: false, error: msg };
  }
}
