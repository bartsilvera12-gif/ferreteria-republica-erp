import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { ymdInicioFinMesLocal } from "@/lib/fechas/calendario";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import {
  assertAllowedChatDataSchema,
  isLikelyUnexposedTenantChatSchema,
} from "@/lib/supabase/chat-data-schema";

/**
 * Rango temporal opcional para filtrar tablas con columna fecha.
 * Solo se aplica si vienen `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` válidos.
 * Backward compatible: sin params, el endpoint trae todo el histórico (comportamiento previo).
 */
type DateRange = { desde: string; hasta: string } | null;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateRangeFromQuery(sp: URLSearchParams): DateRange {
  const desde = sp.get("desde")?.trim() ?? "";
  const hasta = sp.get("hasta")?.trim() ?? "";
  if (!desde || !hasta) return null;
  if (!YMD_RE.test(desde) || !YMD_RE.test(hasta)) return null;
  if (desde > hasta) return null;
  return { desde, hasta };
}

/**
 * Dia siguiente a `ymd`, en YYYY-MM-DD.
 *
 * El filtro de rango usa `< diaSiguiente(hasta)` en vez de `<= hasta`: en las
 * columnas `timestamptz` (por ejemplo `ventas.fecha`) comparar contra la fecha
 * pelada equivale a `<= hasta 00:00:00`, con lo cual todo lo del ultimo dia del
 * periodo quedaba afuera y los totales del reporte no cerraban.
 * En columnas `date` el resultado es el mismo que `<= hasta`.
 */
function diaSiguiente(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

/**
 * PostgREST corta las respuestas en `max-rows` (1000 por defecto en Supabase) y
 * lo hace en silencio: no hay error, simplemente faltan filas. Con varios meses
 * de ventas eso hacia que el dashboard sumara un subconjunto del periodo.
 *
 * `fetchAllPaged` recorre el resultado por bloques hasta traerlo completo.
 * `buildQuery` tiene que devolver una query nueva en cada llamada: los builders
 * de supabase-js son de un solo uso.
 */
const PAGE_ROWS = 1000;
const MAX_PAGES = 200;

async function fetchAllPaged<T>(
  buildQuery: () => {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  }
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const acumulado: T[] = [];
  for (let pagina = 0; pagina < MAX_PAGES; pagina++) {
    const desde = pagina * PAGE_ROWS;
    const { data, error } = await buildQuery().range(desde, desde + PAGE_ROWS - 1);
    if (error) return { data: null, error };
    const lote = data ?? [];
    acumulado.push(...lote);
    if (lote.length < PAGE_ROWS) return { data: acumulado, error: null };
  }
  console.warn("[dashboard/tenant-tables] fetchAllPaged corto en MAX_PAGES", {
    filas: acumulado.length,
  });
  return { data: acumulado, error: null };
}

/**
 * Fallback PG directo para tablas operativas que necesita el dashboard
 * cuando el tenant `erp_*` no esta expuesto en PostgREST.
 * Por ahora solo cubrimos productos y compras (alimentan DashInventario);
 * el resto de modulos (clientes/facturas/etc.) sigue por supabase.from
 * y degrada silenciosamente con query_errors si el schema no esta expuesto.
 */
async function fallbackProductosPg(schemaRaw: string, empresaId: string): Promise<unknown[]> {
  try {
    const schema = assertAllowedChatDataSchema(schemaRaw);
    const pool = getChatPostgresPool();
    if (!pool) return [];
    const t = quoteSchemaTable(schema, "productos");
    const { rows } = await pool.query(
      `SELECT * FROM ${t} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    return rows;
  } catch (e) {
    console.error("[dashboard/tenant-tables] fallbackProductosPg", {
      schema: schemaRaw,
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

async function fallbackComprasPg(
  schemaRaw: string,
  empresaId: string,
  range: DateRange
): Promise<unknown[]> {
  try {
    const schema = assertAllowedChatDataSchema(schemaRaw);
    const pool = getChatPostgresPool();
    if (!pool) return [];
    const t = quoteSchemaTable(schema, "compras");
    if (range) {
      const { rows } = await pool.query(
        `SELECT * FROM ${t} WHERE empresa_id = $1::uuid AND fecha >= $2::date AND fecha < ($3::date + INTERVAL '1 day')`,
        [empresaId, range.desde, range.hasta]
      );
      return rows;
    }
    const { rows } = await pool.query(
      `SELECT * FROM ${t} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    return rows;
  } catch (e) {
    console.error("[dashboard/tenant-tables] fallbackComprasPg", {
      schema: schemaRaw,
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

async function fallbackVentasPg(
  schemaRaw: string,
  empresaId: string,
  range: DateRange
): Promise<unknown[]> {
  try {
    const schema = assertAllowedChatDataSchema(schemaRaw);
    const pool = getChatPostgresPool();
    if (!pool) return [];
    const t = quoteSchemaTable(schema, "ventas");
    if (range) {
      const { rows } = await pool.query(
        `SELECT * FROM ${t} WHERE empresa_id = $1::uuid AND fecha >= $2::date AND fecha < ($3::date + INTERVAL '1 day')`,
        [empresaId, range.desde, range.hasta]
      );
      return rows;
    }
    const { rows } = await pool.query(
      `SELECT * FROM ${t} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    return rows;
  } catch (e) {
    console.error("[dashboard/tenant-tables] fallbackVentasPg", {
      schema: schemaRaw,
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

async function fallbackVentasItemsPg(
  schemaRaw: string,
  empresaId: string,
  ventaIds: string[] | null
): Promise<unknown[]> {
  try {
    const schema = assertAllowedChatDataSchema(schemaRaw);
    const pool = getChatPostgresPool();
    if (!pool) return [];
    const t = quoteSchemaTable(schema, "ventas_items");
    if (ventaIds !== null) {
      if (ventaIds.length === 0) return [];
      const { rows } = await pool.query(
        `SELECT * FROM ${t} WHERE empresa_id = $1::uuid AND venta_id = ANY($2::uuid[])`,
        [empresaId, ventaIds]
      );
      return rows;
    }
    const { rows } = await pool.query(
      `SELECT * FROM ${t} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    return rows;
  } catch (e) {
    console.error("[dashboard/tenant-tables] fallbackVentasItemsPg", {
      schema: schemaRaw,
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

type TableKey =
  | "clientes"
  | "facturas"
  | "pagos"
  | "tipificaciones"
  | "productos"
  | "ventas"
  | "ventas_items"
  | "compras"
  | "gastos"
  | "suscripciones"
  | "clientes_baja_mes"
  | "suscripciones_canceladas"
  | "notas_credito";

/**
 * Antes: si **cualquier** consulta fallaba (p. ej. `clientes.deleted_at` inexistente en un tenant clonado),
 * se respondía 400 y el dashboard quedaba **entero** vacío (incluido financiero con facturas/pagos válidos).
 * Ahora: se devuelven arrays por tabla; errores PostgREST van en `query_errors` sin tumbar el resto.
 */
function pickRows<T>(
  key: TableKey,
  result: { data: T[] | null; error: { message: string } | null },
  errors: Partial<Record<TableKey, string>>
): T[] {
  if (result.error) {
    errors[key] = result.error.message;
    return [];
  }
  return result.data ?? [];
}

/**
 * GET /api/dashboard/tenant-tables
 * Filas de tablas operativas para el dashboard (misma empresa, service role + schema tenant).
 *
 * Query params opcionales:
 *  - desde=YYYY-MM-DD&hasta=YYYY-MM-DD : filtra las tablas temporales por rango.
 *    Aplica a: facturas (fecha), pagos (fecha_pago), ventas (fecha), ventas_items (via venta_id),
 *    compras (fecha), gastos (fecha), tipificaciones (fecha).
 *    NO aplica a: clientes, productos, suscripciones (necesarias completas para joins / estado actual).
 *  - Sin params: comportamiento original (sin filtro) — backward compatible.
 *  - debug=1 : incluye _debug_data_schema y _debug_empresa_id en la respuesta.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const empresaId = auth.empresa_id;

    const now = new Date();
    const { inicioYmd: inicioMes, finYmd: finMes } = ymdInicioFinMesLocal(now);

    const sp = request.nextUrl.searchParams;
    const includeDebug = sp.get("debug") === "1";
    const range = parseDateRangeFromQuery(sp);

    // Resolvemos el schema siempre — lo usamos para fallback PG directo
    // cuando se detecta un tenant no expuesto en PostgREST.
    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);
    const usarPg = isLikelyUnexposedTenantChatSchema(dataSchema);

    /** Helper: arma una query con o sin filtro de fecha según `range`. */
    const buildFacturasQ = () => {
      const base = supabase.from("facturas").select("*").eq("empresa_id", empresaId);
      return range ? base.gte("fecha", range.desde).lt("fecha", diaSiguiente(range.hasta)) : base;
    };
    const buildPagosQ = () => {
      const base = supabase.from("pagos").select("id, factura_id, monto, fecha_pago").eq("empresa_id", empresaId);
      return range ? base.gte("fecha_pago", range.desde).lt("fecha_pago", diaSiguiente(range.hasta)) : base;
    };
    const buildTipificacionesQ = () => {
      const base = supabase.from("tipificaciones").select("*").eq("empresa_id", empresaId);
      return range ? base.gte("fecha", range.desde).lt("fecha", diaSiguiente(range.hasta)) : base;
    };
    const buildVentasQ = () => {
      const base = supabase.from("ventas").select("*").eq("empresa_id", empresaId);
      return range ? base.gte("fecha", range.desde).lt("fecha", diaSiguiente(range.hasta)) : base;
    };
    const buildComprasQ = () => {
      const base = supabase.from("compras").select("*").eq("empresa_id", empresaId);
      return range ? base.gte("fecha", range.desde).lt("fecha", diaSiguiente(range.hasta)) : base;
    };
    const buildGastosQ = () => {
      const base = supabase.from("gastos").select("id, monto, fecha").eq("empresa_id", empresaId);
      return range ? base.gte("fecha", range.desde).lt("fecha", diaSiguiente(range.hasta)) : base;
    };

    /**
     * ventas_items no tiene columna fecha directa; se filtra por `venta_id` de ventas en rango.
     * Si hay rango: se ejecuta secuencial después de ventas para conocer los IDs válidos.
     * Si no hay rango: se ejecuta en paralelo con el resto (comportamiento previo).
     */
    const ventasItemsParalelo = range
      ? Promise.resolve({ data: null as unknown[] | null, error: null as { message: string } | null })
      : fetchAllPaged<unknown>(() => supabase.from("ventas_items").select("*").eq("empresa_id", empresaId));

    const [
      clientesQ,
      facturasQ,
      pagosQ,
      tipificacionesQ,
      productosQ,
      ventasQ,
      ventasItemsQ,
      comprasQ,
      gastosQ,
      suscripcionesDashQ,
      bajasQ,
      suscBajasQ,
      notaCreditoQ,
    ] = await Promise.all([
      /** Sin `.is("deleted_at", null)` en PostgREST: en tenants viejos la columna puede no existir y rompía todo el batch. */
      fetchAllPaged(() => supabase.from("clientes").select("*").eq("empresa_id", empresaId)),
      fetchAllPaged(buildFacturasQ),
      fetchAllPaged(buildPagosQ),
      fetchAllPaged(buildTipificacionesQ),
      fetchAllPaged(() => supabase.from("productos").select("*").eq("empresa_id", empresaId)),
      fetchAllPaged(buildVentasQ),
      ventasItemsParalelo,
      fetchAllPaged(buildComprasQ),
      fetchAllPaged(buildGastosQ),
      fetchAllPaged(() =>
        supabase
          .from("suscripciones")
          .select("id, cliente_id, precio, moneda, fecha_inicio, created_at")
          .eq("empresa_id", empresaId)
      ),
      supabase
        .from("clientes")
        .select("id")
        .eq("empresa_id", empresaId)
        .not("baja_operativa_at", "is", null)
        .gte("baja_operativa_at", inicioMes)
        .lte("baja_operativa_at", finMes + "T23:59:59.999Z"),
      supabase
        .from("suscripciones")
        .select("cliente_id, precio")
        .eq("empresa_id", empresaId)
        .eq("estado", "cancelada"),
      supabase
        .from("nota_credito")
        .select("id, factura_id, monto, estado_erp")
        .eq("empresa_id", empresaId),
    ]);

    const queryErrors: Partial<Record<TableKey, string>> = {};

    // Productos / compras alimentan DashInventario. Si el supabase.from
    // tira Invalid schema (PGRST106) — caso erp_* no expuesto — caemos a PG directo.
    let productosRows = pickRows("productos", productosQ, queryErrors);
    if ((productosRows.length === 0 && queryErrors.productos) || (usarPg && productosRows.length === 0)) {
      productosRows = await fallbackProductosPg(dataSchema, empresaId);
      if (productosRows.length > 0) delete queryErrors.productos;
    }
    let comprasRows = pickRows("compras", comprasQ, queryErrors);
    if ((comprasRows.length === 0 && queryErrors.compras) || (usarPg && comprasRows.length === 0)) {
      comprasRows = await fallbackComprasPg(dataSchema, empresaId, range);
      if (comprasRows.length > 0) delete queryErrors.compras;
    }
    let ventasRows = pickRows("ventas", ventasQ, queryErrors);
    if ((ventasRows.length === 0 && queryErrors.ventas) || (usarPg && ventasRows.length === 0)) {
      ventasRows = await fallbackVentasPg(dataSchema, empresaId, range);
      if (ventasRows.length > 0) delete queryErrors.ventas;
    }

    /**
     * ventas_items con filtro: ahora que tenemos las ventas filtradas, traemos solo
     * los items de esas ventas. Sin filtro: ya vino del Promise.all.
     */
    let ventasItemsRows: unknown[];
    if (range) {
      const ventaIds = ventasRows
        .map((v) => (v as { id?: string }).id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      if (ventaIds.length === 0) {
        ventasItemsRows = [];
      } else {
        /**
         * En lotes: un `.in(...)` con miles de UUIDs arma una URL que PostgREST
         * rechaza, y cada lote se pagina porque los items superan holgadamente
         * el tope de filas por respuesta.
         */
        const LOTE_IDS = 300;
        const acumulado: unknown[] = [];
        let itemsErr: { message: string } | null = null;
        for (let i = 0; i < ventaIds.length && !itemsErr; i += LOTE_IDS) {
          const lote = ventaIds.slice(i, i + LOTE_IDS);
          const { data, error } = await fetchAllPaged<unknown>(() =>
            supabase.from("ventas_items").select("*").eq("empresa_id", empresaId).in("venta_id", lote)
          );
          if (error) itemsErr = error;
          else acumulado.push(...(data ?? []));
        }
        const itemsRes = { data: itemsErr ? null : acumulado, error: itemsErr };
        ventasItemsRows = pickRows("ventas_items", itemsRes, queryErrors);
        if ((ventasItemsRows.length === 0 && queryErrors.ventas_items) || (usarPg && ventasItemsRows.length === 0)) {
          ventasItemsRows = await fallbackVentasItemsPg(dataSchema, empresaId, ventaIds);
          if (ventasItemsRows.length > 0) delete queryErrors.ventas_items;
        }
      }
    } else {
      ventasItemsRows = pickRows("ventas_items", ventasItemsQ as { data: unknown[] | null; error: { message: string } | null }, queryErrors);
      if ((ventasItemsRows.length === 0 && queryErrors.ventas_items) || (usarPg && ventasItemsRows.length === 0)) {
        ventasItemsRows = await fallbackVentasItemsPg(dataSchema, empresaId, null);
        if (ventasItemsRows.length > 0) delete queryErrors.ventas_items;
      }
    }

    const payload = {
      clientes: pickRows("clientes", clientesQ, queryErrors),
      facturas: pickRows("facturas", facturasQ, queryErrors),
      pagos: pickRows("pagos", pagosQ, queryErrors),
      tipificaciones: pickRows("tipificaciones", tipificacionesQ, queryErrors),
      productos: productosRows,
      ventas: ventasRows,
      ventas_items: ventasItemsRows,
      compras: comprasRows,
      gastos: pickRows("gastos", gastosQ, queryErrors),
      suscripciones: pickRows("suscripciones", suscripcionesDashQ, queryErrors),
      clientes_baja_mes: pickRows("clientes_baja_mes", bajasQ, queryErrors),
      suscripciones_canceladas: pickRows("suscripciones_canceladas", suscBajasQ, queryErrors),
      notas_credito: pickRows("notas_credito", notaCreditoQ, queryErrors),
      ...(Object.keys(queryErrors).length > 0 ? { query_errors: queryErrors } : {}),
      ...(includeDebug && dataSchema
        ? {
            _debug_data_schema: dataSchema,
            _debug_empresa_id: empresaId,
            _debug_date_range: range,
          }
        : {}),
    };

    return NextResponse.json(successResponse(payload));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
