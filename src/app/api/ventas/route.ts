import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type { Venta, LineaVenta, TipoIvaVenta } from "@/lib/ventas/types";

interface VentaRow {
  id: string;
  empresa_id: string;
  numero_control: string;
  moneda: string;
  tipo_cambio: number | string;
  subtotal: number | string;
  monto_iva: number | string;
  total: number | string;
  tipo_venta: string;
  plazo_dias: number | null;
  fecha: string;
}

interface VentaItemRow {
  venta_id: string;
  producto_id: string;
  producto_nombre: string;
  sku: string;
  cantidad: number | string;
  precio_venta_original: number | string;
  precio_venta: number | string;
  tipo_iva: string;
  subtotal: number | string;
  monto_iva: number | string;
  total_linea: number | string;
}

function num(v: number | string): number {
  return typeof v === "number" ? v : Number(v);
}

function mapItems(rows: VentaItemRow[]): LineaVenta[] {
  return rows.map((r) => ({
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    sku: r.sku,
    cantidad: num(r.cantidad),
    precio_venta_original: num(r.precio_venta_original),
    precio_venta: num(r.precio_venta),
    tipo_iva: r.tipo_iva as TipoIvaVenta,
    subtotal: num(r.subtotal),
    monto_iva: num(r.monto_iva),
    total_linea: num(r.total_linea),
  }));
}

const LISTA_LIMITE = 500;
const PAGE_ROWS = 1000;
const LOTE_IDS = 300;

/** Trae todos los items de las ventas indicadas, en lotes y paginando cada lote. */
async function fetchVentasItems(
  supabase: AppSupabaseClient,
  empresaId: string,
  ventaIds: string[]
): Promise<VentaItemRow[]> {
  const out: VentaItemRow[] = [];
  const COLS =
    "venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta_original, precio_venta, tipo_iva, subtotal, monto_iva, total_linea";

  for (let i = 0; i < ventaIds.length; i += LOTE_IDS) {
    const lote = ventaIds.slice(i, i + LOTE_IDS);
    for (let pagina = 0; ; pagina++) {
      const desde = pagina * PAGE_ROWS;
      const { data, error } = await supabase
        .from("ventas_items")
        .select(COLS)
        .eq("empresa_id", empresaId)
        .in("venta_id", lote)
        .range(desde, desde + PAGE_ROWS - 1);
      if (error) throw new Error(error.message);
      const filas = (data ?? []) as VentaItemRow[];
      out.push(...filas);
      if (filas.length < PAGE_ROWS) break;
    }
  }
  return out;
}

/** GET /api/ventas — listado vía PostgREST (compatible Hostinger sin pool). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const ventasQ = await ctx.supabase
      .from("ventas")
      .select(
        "id, empresa_id, numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, tipo_venta, plazo_dias, metodo_pago, fecha"
      )
      .eq("empresa_id", empresaId)
      .order("fecha", { ascending: false })
      .limit(LISTA_LIMITE);
    if (ventasQ.error) throw new Error(ventasQ.error.message);

    const ventasRows = (ventasQ.data ?? []) as VentaRow[];
    const ventaIds = ventasRows.map((v) => v.id);

    /**
     * Los items se piden solo para las ventas listadas y en lotes paginados.
     *
     * Antes se pedian todos los items de la empresa de una sola vez: PostgREST
     * corta en `max-rows` sin devolver error, asi que a partir de cierto volumen
     * llegaban items incompletos y las metricas de la pantalla (unidades
     * vendidas, totales por venta) quedaban por debajo de lo real.
     */
    const itemsRows = await fetchVentasItems(ctx.supabase, empresaId, ventaIds);

    const byVenta = new Map<string, VentaItemRow[]>();
    for (const row of itemsRows) {
      const list = byVenta.get(row.venta_id) ?? [];
      list.push(row);
      byVenta.set(row.venta_id, list);
    }

    const ventas: Venta[] = ventasRows.map((r) => {
      const lineRows = byVenta.get(r.id) ?? [];
      return {
        id: r.id,
        numero_control: r.numero_control,
        items: mapItems(lineRows),
        moneda: r.moneda === "USD" ? "USD" : "GS",
        tipo_cambio: num(r.tipo_cambio),
        subtotal: num(r.subtotal),
        monto_iva: num(r.monto_iva),
        total: num(r.total),
        tipo_venta: r.tipo_venta === "CREDITO" ? "CREDITO" : "CONTADO",
        plazo_dias: r.plazo_dias ?? undefined,
        metodo_pago: (r as unknown as { metodo_pago?: string }).metodo_pago === "tarjeta"
          ? "tarjeta"
          : (r as unknown as { metodo_pago?: string }).metodo_pago === "transferencia"
          ? "transferencia"
          : (r as unknown as { metodo_pago?: string }).metodo_pago === "efectivo"
          ? "efectivo"
          : undefined,
        fecha: r.fecha,
      };
    });

    return NextResponse.json(successResponse({ ventas }));
  } catch (err) {
    console.error("[/api/ventas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las ventas."), { status: 500 });
  }
}
