/**
 * Anulación de una venta.
 *
 * Corre en UNA sola transacción PostgreSQL (pool directo, BEGIN/COMMIT) con
 * SELECT ... FOR UPDATE sobre la venta, sus productos y su cuenta por cobrar,
 * para que la reversa de stock/caja no se duplique con operaciones simultáneas.
 *
 * Qué revierte (solo los efectos que la propia venta generó):
 *  1. STOCK: por cada movimiento SALIDA (origen 'venta') que dejó la venta,
 *     reintegra la cantidad al `stock_actual` del producto/insumo y registra un
 *     movimiento inverso ENTRADA. Reutiliza el mismo criterio que create-venta:
 *     lo que salió, vuelve. (origen 'ajuste_manual': la anulación no es una
 *     compra/venta/producción/devolución, y ese es el valor permitido por el
 *     CHECK de movimientos_inventario que refleja un ajuste de stock del sistema.)
 *  2. CAJA: NO inserta ningún movimiento de caja. El arqueo deriva el efectivo
 *     directamente de la tabla `ventas` por `caja_id` y EXCLUYE las anuladas
 *     (ver lib/caja/server.ts); marcar la venta 'anulada' ya la saca de la caja.
 *     Insertar un caja_movimientos inverso sería un doble descuento.
 *  3. CUENTA POR COBRAR (solo ventas a CRÉDITO): si la venta generó una CxC sin
 *     cobros, la marca 'anulada' con saldo 0. Si ya tiene cobros, BLOQUEA la
 *     anulación (no se deshacen cobros silenciosamente).
 *  4. FACTURA AUTOIMPRESOR: si la venta tiene factura, registra la reversa en
 *     `nota_credito_autoimpresor` (snapshot de la factura, alcance 'total').
 *     Es el mecanismo de reversa que este sistema tiene previsto; NO constituye
 *     una garantía de cumplimiento fiscal externo (SET/SIFEN).
 *  5. ESTADO: marca `ventas.estado = 'anulada'` (la venta NO se borra: queda
 *     auditada y deja de contar como venta válida en dashboard/reportes/caja).
 *
 * Solo se pueden anular ventas en estado 'completada'. Una venta con
 * devoluciones (parcial/total) ya movió stock por otro camino: se bloquea para
 * no revertir dos veces (no se mezcla con el módulo de devoluciones).
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export type MotivoBloqueoAnulacion =
  | "venta_no_encontrada"
  | "venta_ya_anulada"
  | "venta_con_devoluciones"
  | "cxc_con_cobros";

export class AnularVentaBloqueadaError extends Error {
  motivo: MotivoBloqueoAnulacion;
  constructor(motivo: MotivoBloqueoAnulacion, message: string) {
    super(message);
    this.name = "AnularVentaBloqueadaError";
    this.motivo = motivo;
  }
}

export interface UsuarioCtx {
  id: string | null;
  nombre: string | null;
}

export interface VentaAnulada {
  venta_id: string;
  numero_control: string;
  estado: "anulada";
  nota_credito_id: string | null;
  cuenta_por_cobrar_anulada: boolean;
  productos_reintegrados: number;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de base de datos no disponible.");
  return p;
}

/**
 * Anula una venta y revierte sus efectos. Atómico: o se escribe todo o nada.
 * `motivo` es opcional (se guarda en la nota de crédito y en la observación).
 */
export async function anularVenta(
  schemaRaw: string,
  empresaId: string,
  usuario: UsuarioCtx,
  ventaId: string,
  motivo: string | null
): Promise<VentaAnulada> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tP = quoteSchemaTable(schema, "productos");
  const tMI = quoteSchemaTable(schema, "movimientos_inventario");
  const tFA = quoteSchemaTable(schema, "factura_autoimpresor");
  const tNC = quoteSchemaTable(schema, "nota_credito_autoimpresor");
  const tCxC = quoteSchemaTable(schema, "cuentas_por_cobrar");

  const motivoLimpio = motivo == null ? null : String(motivo).trim().slice(0, 500) || null;

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // 1) Venta bloqueada.
    const vQ = await client.query(
      `SELECT id::text, numero_control, estado, tipo_venta, observaciones
         FROM ${tV} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [ventaId, empresaId]
    );
    const venta = vQ.rows[0];
    if (!venta) {
      throw new AnularVentaBloqueadaError("venta_no_encontrada", "La venta no existe.");
    }
    const estado = String(venta.estado ?? "");
    const numeroControl = String(venta.numero_control ?? "");
    if (estado === "anulada") {
      throw new AnularVentaBloqueadaError("venta_ya_anulada", "La venta ya está anulada.");
    }
    // Solo ventas 'completada'. Con devoluciones (parcial/total) el stock ya se
    // movió por otro camino; anular acá lo revertiría dos veces.
    if (estado !== "completada") {
      throw new AnularVentaBloqueadaError(
        "venta_con_devoluciones",
        "La venta tiene devoluciones registradas; gestionalas antes de anular."
      );
    }

    // 2) CxC (solo CRÉDITO). Sin cobros -> se anula; con cobros -> bloquea.
    let cxcAnulada = false;
    if (String(venta.tipo_venta ?? "").toUpperCase() === "CREDITO") {
      const cxcQ = await client.query(
        `SELECT id::text, total, saldo, estado
           FROM ${tCxC} WHERE venta_id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
        [ventaId, empresaId]
      );
      const cxc = cxcQ.rows[0];
      if (cxc) {
        const total = num(cxc.total);
        const saldo = num(cxc.saldo);
        const conCobros = String(cxc.estado ?? "") === "pagado" || saldo < total - 0.01;
        if (conCobros) {
          throw new AnularVentaBloqueadaError(
            "cxc_con_cobros",
            "La venta a crédito ya tiene cobros registrados; revertí los cobros antes de anular."
          );
        }
        await client.query(
          `UPDATE ${tCxC} SET estado = 'anulada', saldo = 0, updated_at = now()
            WHERE id = $1::uuid AND empresa_id = $2::uuid`,
          [String(cxc.id), empresaId]
        );
        cxcAnulada = true;
      }
    }

    // 3) Reversa de stock: por cada SALIDA (origen 'venta') de la venta, reintegra
    //    y deja un movimiento ENTRADA inverso.
    const movQ = await client.query(
      `SELECT producto_id::text AS producto_id, producto_nombre, producto_sku,
              cantidad, costo_unitario
         FROM ${tMI}
        WHERE venta_id = $1::uuid AND empresa_id = $2::uuid
          AND tipo = 'SALIDA' AND origen = 'venta'`,
      [ventaId, empresaId]
    );
    let reintegrados = 0;
    for (const m of movQ.rows) {
      const productoId = str(m.producto_id);
      const cantidad = num(m.cantidad);
      if (!productoId || cantidad === 0) continue;
      // Lock del producto para no cruzar con otra operación de stock.
      const pQ = await client.query(
        `SELECT id FROM ${tP} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
        [productoId, empresaId]
      );
      if (!pQ.rows[0]) continue; // producto borrado: no se puede reintegrar
      await client.query(
        `UPDATE ${tP} SET stock_actual = stock_actual + $3, updated_at = now()
          WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [productoId, empresaId, cantidad]
      );
      await client.query(
        `INSERT INTO ${tMI} (
           empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
           costo_unitario, origen, referencia, venta_id, created_by, usuario_nombre
         ) VALUES ($1::uuid,$2::uuid,$3,$4,'ENTRADA',$5,$6,'ajuste_manual',$7,$8::uuid,$9::uuid,$10)`,
        [
          empresaId, productoId, str(m.producto_nombre) ?? "", str(m.producto_sku) ?? "",
          cantidad, num(m.costo_unitario), `Anulación ${numeroControl}`,
          ventaId, usuario.id, usuario.nombre,
        ]
      );
      reintegrados++;
    }

    // 4) Factura autoimpresor -> nota de crédito autoimpresor (reversa total).
    let notaCreditoId: string | null = null;
    const faQ = await client.query(
      `SELECT id::text, numero_secuencia, numero_completo, establecimiento_codigo,
              punto_expedicion_codigo, timbrado_numero, timbrado_inicio_vigencia,
              timbrado_fin_vigencia, condicion, gravado_10, iva_10, gravado_5, iva_5,
              exentas, total, emitida_at
         FROM ${tFA} WHERE venta_id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
      [ventaId, empresaId]
    );
    const fa = faQ.rows[0];
    if (fa) {
      // Guarda contra doble reversa (la tabla no tiene unique por venta).
      const yaNC = await client.query(
        `SELECT id::text FROM ${tNC} WHERE venta_id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
        [ventaId, empresaId]
      );
      if (yaNC.rows[0]) {
        notaCreditoId = String(yaNC.rows[0].id);
      } else {
        const insNC = await client.query(
          `INSERT INTO ${tNC} (
             empresa_id, factura_autoimpresor_id, venta_id, numero_secuencia, numero_completo,
             establecimiento_codigo, punto_expedicion_codigo, timbrado_numero,
             timbrado_inicio_vigencia, timbrado_fin_vigencia,
             factura_numero_completo, factura_timbrado_numero, factura_fecha, motivo,
             condicion, alcance, gravado_10, iva_10, gravado_5, iva_5, exentas, total,
             created_by, usuario_nombre
           ) VALUES (
             $1::uuid,$2::uuid,$3::uuid,$4::integer,$5,
             $6,$7,$8,
             $9::date,$10::date,
             $11,$12,$13::date,$14,
             $15,'total',$16,$17,$18,$19,$20,$21,
             $22::uuid,$23
           ) RETURNING id::text`,
          [
            empresaId, String(fa.id), ventaId, num(fa.numero_secuencia), str(fa.numero_completo),
            str(fa.establecimiento_codigo), str(fa.punto_expedicion_codigo), str(fa.timbrado_numero),
            fa.timbrado_inicio_vigencia ?? null, fa.timbrado_fin_vigencia ?? null,
            str(fa.numero_completo), str(fa.timbrado_numero), fa.emitida_at ?? null, motivoLimpio,
            str(fa.condicion) ?? "contado", num(fa.gravado_10), num(fa.iva_10), num(fa.gravado_5),
            num(fa.iva_5), num(fa.exentas), num(fa.total),
            usuario.id, usuario.nombre,
          ]
        );
        notaCreditoId = String(insNC.rows[0].id);
      }
    }

    // 5) Estado de la venta -> 'anulada'. Se anota el motivo en la observación
    //    (la tabla ventas no tiene columna de motivo de anulación) sin perder la
    //    observación previa.
    const obsPrev = str(venta.observaciones);
    const sello = `[Anulada${motivoLimpio ? `: ${motivoLimpio}` : ""}]`;
    const obsNueva = obsPrev ? `${obsPrev}\n${sello}` : sello;
    await client.query(
      `UPDATE ${tV} SET estado = 'anulada', observaciones = $3, updated_at = now()
        WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [ventaId, empresaId, obsNueva.slice(0, 4000)]
    );

    await client.query("COMMIT");
    return {
      venta_id: ventaId,
      numero_control: numeroControl,
      estado: "anulada",
      nota_credito_id: notaCreditoId,
      cuenta_por_cobrar_anulada: cxcAnulada,
      productos_reintegrados: reintegrados,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
