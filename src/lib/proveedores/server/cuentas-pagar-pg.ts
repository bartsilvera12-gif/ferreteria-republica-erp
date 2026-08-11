/**
 * Cuentas por pagar a proveedores (#17) — vía PG pool.
 *
 * La DEUDA no se almacena: se deriva de `compras` con tipo_pago='credito',
 * agrupada por numero_control (una factura de compra). El saldo = total de la
 * compra − suma de pagos NO anulados (`pagos_proveedor`).
 *
 * Un pago en efectivo genera un EGRESO en la caja abierta (caja_movimientos),
 * para que el arqueo refleje la salida de dinero. Se linkea el movimiento al
 * pago para poder anular en cascada.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

const PY = "AT TIME ZONE INTERVAL '-3 hours'"; // Paraguay UTC-3 fijo.

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type EstadoCuentaPagar = "pendiente" | "parcial" | "vencida" | "pagada";

export interface CuentaPagarRow {
  numero_control: string;
  proveedor_id: string | null;
  proveedor_nombre: string;
  numero_factura: string | null;
  fecha: string;
  fecha_factura: string | null;
  plazo_dias: number | null;
  vencimiento: string | null;
  total_compra: number;
  pagado: number;
  saldo: number;
  estado: EstadoCuentaPagar;
  dias_vencido: number;
}

export interface CuentasPagarResultado {
  items: CuentaPagarRow[];
  totales: {
    total_compra: number;
    pagado: number;
    saldo: number;
    vencido: number;
    cantidad: number;
  };
}

/** Lista las deudas a proveedores (compras a crédito) con su saldo y estado. */
export async function listCuentasPagar(
  schemaRaw: string,
  empresaId: string,
  opts?: { proveedor?: string; estado?: EstadoCuentaPagar | "todas"; soloPendientes?: boolean }
): Promise<CuentasPagarResultado> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tP = quoteSchemaTable(schema, "pagos_proveedor");

  const args: unknown[] = [empresaId];
  let provCond = "";
  const prov = (opts?.proveedor ?? "").trim();
  if (prov) { args.push(`%${prov}%`); provCond = `AND d.proveedor_nombre ILIKE $${args.length}`; }

  const { rows } = await pool().query(
    `WITH deuda AS (
       SELECT numero_control,
              max(proveedor_id::text) AS proveedor_id,
              max(proveedor_nombre)   AS proveedor_nombre,
              max(numero_factura)     AS numero_factura,
              min(fecha)              AS fecha,
              max(fecha_factura)      AS fecha_factura,
              max(plazo_dias)         AS plazo_dias,
              sum(total)              AS total_compra
         FROM ${tC}
        WHERE empresa_id = $1::uuid AND tipo_pago = 'credito'
        GROUP BY numero_control
     ),
     pag AS (
       SELECT numero_control, COALESCE(sum(monto), 0) AS pagado
         FROM ${tP}
        WHERE empresa_id = $1::uuid AND anulado_at IS NULL
        GROUP BY numero_control
     )
     SELECT d.numero_control, d.proveedor_id, d.proveedor_nombre, d.numero_factura,
            d.fecha, d.fecha_factura, d.plazo_dias, d.total_compra,
            COALESCE(p.pagado, 0) AS pagado,
            (d.total_compra - COALESCE(p.pagado, 0)) AS saldo,
            (COALESCE(d.fecha_factura, (d.fecha ${PY})::date) + COALESCE(d.plazo_dias, 0))::text AS vencimiento,
            ((now() ${PY})::date - (COALESCE(d.fecha_factura, (d.fecha ${PY})::date) + COALESCE(d.plazo_dias, 0))) AS dias_vencido
       FROM deuda d
       LEFT JOIN pag p ON p.numero_control = d.numero_control
      WHERE TRUE ${provCond}
      ORDER BY (d.total_compra - COALESCE(p.pagado, 0)) > 0 DESC,
               (COALESCE(d.fecha_factura, (d.fecha ${PY})::date) + COALESCE(d.plazo_dias, 0)) ASC NULLS LAST`,
    args
  );

  const estadoFiltro = opts?.estado ?? "todas";
  const items: CuentaPagarRow[] = [];
  const totales = { total_compra: 0, pagado: 0, saldo: 0, vencido: 0, cantidad: 0 };

  for (const r of rows as Record<string, unknown>[]) {
    const total = num(r.total_compra);
    const pagado = num(r.pagado);
    const saldo = Math.round((total - pagado) * 100) / 100;
    const diasVencido = num(r.dias_vencido);
    const estado: EstadoCuentaPagar =
      saldo <= 0 ? "pagada" : diasVencido > 0 ? "vencida" : pagado > 0 ? "parcial" : "pendiente";

    if (opts?.soloPendientes && saldo <= 0) continue;
    if (estadoFiltro !== "todas" && estado !== estadoFiltro) continue;

    const row: CuentaPagarRow = {
      numero_control: String(r.numero_control ?? ""),
      proveedor_id: (r.proveedor_id as string | null) ?? null,
      proveedor_nombre: String(r.proveedor_nombre ?? "—"),
      numero_factura: (r.numero_factura as string | null) ?? null,
      fecha: String(r.fecha ?? ""),
      fecha_factura: r.fecha_factura ? String(r.fecha_factura) : null,
      plazo_dias: r.plazo_dias == null ? null : num(r.plazo_dias),
      vencimiento: r.vencimiento ? String(r.vencimiento) : null,
      total_compra: total,
      pagado,
      saldo,
      estado,
      dias_vencido: saldo > 0 && diasVencido > 0 ? diasVencido : 0,
    };
    items.push(row);
    totales.total_compra += total;
    totales.pagado += pagado;
    totales.saldo += saldo > 0 ? saldo : 0;
    if (estado === "vencida") totales.vencido += saldo;
    totales.cantidad++;
  }

  return { items, totales };
}

export interface PagoProveedorRow {
  id: string;
  numero_control: string;
  numero_factura: string | null;
  proveedor_nombre: string | null;
  monto: number;
  medio_pago: string;
  fecha: string;
  usuario_nombre: string | null;
  observacion: string | null;
  anulado_at: string | null;
}

/** Pagos registrados (no anulados salvo `incluirAnulados`) de una compra o proveedor. */
export async function listPagosProveedor(
  schemaRaw: string,
  empresaId: string,
  opts: { numeroControl?: string; proveedorId?: string; incluirAnulados?: boolean }
): Promise<PagoProveedorRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tP = quoteSchemaTable(schema, "pagos_proveedor");
  const args: unknown[] = [empresaId];
  const conds: string[] = ["empresa_id = $1::uuid"];
  if (opts.numeroControl) { args.push(opts.numeroControl); conds.push(`numero_control = $${args.length}`); }
  if (opts.proveedorId) { args.push(opts.proveedorId); conds.push(`proveedor_id = $${args.length}::uuid`); }
  if (!opts.incluirAnulados) conds.push("anulado_at IS NULL");

  const { rows } = await pool().query(
    `SELECT id::text AS id, numero_control, numero_factura, proveedor_nombre,
            monto, medio_pago, fecha::text AS fecha, usuario_nombre, observacion,
            anulado_at::text AS anulado_at
       FROM ${tP}
      WHERE ${conds.join(" AND ")}
      ORDER BY fecha DESC`,
    args
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    numero_control: String(r.numero_control ?? ""),
    numero_factura: (r.numero_factura as string | null) ?? null,
    proveedor_nombre: (r.proveedor_nombre as string | null) ?? null,
    monto: num(r.monto),
    medio_pago: String(r.medio_pago ?? "efectivo"),
    fecha: String(r.fecha ?? ""),
    usuario_nombre: (r.usuario_nombre as string | null) ?? null,
    observacion: (r.observacion as string | null) ?? null,
    anulado_at: (r.anulado_at as string | null) ?? null,
  }));
}

export interface RegistrarPagoInput {
  numeroControl: string;
  monto: number;
  medioPago: "efectivo" | "transferencia" | "tarjeta" | "otro";
  observacion: string | null;
  usuarioId: string | null;
  usuarioNombre: string | null;
  usuarioEmail: string | null;
}

/**
 * Registra un pago a proveedor contra una compra a crédito. En efectivo, además
 * crea un egreso en la caja abierta. Transaccional (pago + movimiento).
 */
export async function registrarPagoProveedor(
  schemaRaw: string,
  empresaId: string,
  input: RegistrarPagoInput
): Promise<{ id: string; saldo: number }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tP = quoteSchemaTable(schema, "pagos_proveedor");
  const tM = quoteSchemaTable(schema, "caja_movimientos");
  const tCajas = quoteSchemaTable(schema, "cajas");

  const monto = Math.round(num(input.monto) * 100) / 100;
  if (!(monto > 0)) throw new Error("El monto del pago debe ser mayor a 0.");
  const numeroControl = String(input.numeroControl ?? "").trim();
  if (!numeroControl) throw new Error("Falta la compra (numero_control).");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // 1) Datos de la compra a crédito + saldo actual (con lock del cálculo).
    const dQ = await client.query(
      `SELECT max(proveedor_id::text) AS proveedor_id,
              max(proveedor_nombre)   AS proveedor_nombre,
              max(numero_factura)     AS numero_factura,
              sum(total)              AS total_compra
         FROM ${tC}
        WHERE empresa_id = $1::uuid AND tipo_pago = 'credito' AND numero_control = $2`,
      [empresaId, numeroControl]
    );
    const d = dQ.rows[0] as Record<string, unknown> | undefined;
    const totalCompra = num(d?.total_compra);
    if (!d || totalCompra <= 0) throw new Error("La compra a crédito no existe o no tiene saldo.");

    const pQ = await client.query(
      `SELECT COALESCE(sum(monto), 0) AS pagado FROM ${tP}
        WHERE empresa_id = $1::uuid AND numero_control = $2 AND anulado_at IS NULL`,
      [empresaId, numeroControl]
    );
    const pagado = num((pQ.rows[0] as Record<string, unknown>)?.pagado);
    const saldoActual = Math.round((totalCompra - pagado) * 100) / 100;
    if (saldoActual <= 0) throw new Error("Esta compra ya está saldada.");
    if (monto > saldoActual + 0.01) {
      throw new Error(`El pago (${monto}) supera el saldo pendiente (${saldoActual}).`);
    }

    // 2) Egreso de caja si es efectivo (requiere caja abierta).
    let movimientoCajaId: string | null = null;
    let cajaId: string | null = null;
    if (input.medioPago === "efectivo") {
      const cQ = await client.query(
        `SELECT id::text AS id FROM ${tCajas}
          WHERE empresa_id = $1::uuid AND estado = 'abierta'
          ORDER BY fecha_apertura DESC LIMIT 1`,
        [empresaId]
      );
      if (cQ.rows.length === 0) {
        throw new Error("No hay una caja abierta. Abrí una caja para registrar el pago en efectivo (o elegí otro medio).");
      }
      cajaId = String((cQ.rows[0] as { id: string }).id);
      const concepto = `Pago a proveedor ${d.proveedor_nombre ?? ""} — compra ${numeroControl}`.slice(0, 200);
      const mIns = await client.query(
        `INSERT INTO ${tM} (empresa_id, caja_id, tipo, concepto, monto, medio_pago, usuario_id, usuario_email, observacion)
         VALUES ($1::uuid, $2::uuid, 'egreso', $3, $4::numeric, 'efectivo', $5::uuid, $6, $7)
         RETURNING id::text AS id`,
        [empresaId, cajaId, concepto, monto, input.usuarioId, input.usuarioEmail, input.observacion]
      );
      movimientoCajaId = String((mIns.rows[0] as { id: string }).id);
    }

    // 3) Registrar el pago.
    const ins = await client.query(
      `INSERT INTO ${tP} (empresa_id, proveedor_id, proveedor_nombre, numero_control, numero_factura,
                          monto, medio_pago, caja_id, movimiento_caja_id, usuario_id, usuario_nombre, observacion)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::numeric, $7, $8::uuid, $9::uuid, $10::uuid, $11, $12)
       RETURNING id::text AS id`,
      [
        empresaId, (d.proveedor_id as string | null) ?? null, (d.proveedor_nombre as string | null) ?? null,
        numeroControl, (d.numero_factura as string | null) ?? null,
        monto, input.medioPago, cajaId, movimientoCajaId,
        input.usuarioId, input.usuarioNombre, input.observacion,
      ]
    );
    const id = String((ins.rows[0] as { id: string }).id);

    await client.query("COMMIT");
    return { id, saldo: Math.round((saldoActual - monto) * 100) / 100 };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Anula (baja reversible) un pago y, si tenía egreso de caja, también lo anula. */
export async function anularPagoProveedor(
  schemaRaw: string,
  empresaId: string,
  pagoId: string,
  usuarioId: string | null,
  motivo: string | null
): Promise<boolean> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tP = quoteSchemaTable(schema, "pagos_proveedor");
  const tM = quoteSchemaTable(schema, "caja_movimientos");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE ${tP} SET anulado_at = now()
        WHERE id = $1::uuid AND empresa_id = $2::uuid AND anulado_at IS NULL
        RETURNING movimiento_caja_id::text AS movimiento_caja_id`,
      [pagoId, empresaId]
    );
    if (upd.rows.length === 0) { await client.query("ROLLBACK"); return false; }
    const movId = (upd.rows[0] as Record<string, unknown>).movimiento_caja_id as string | null;
    if (movId) {
      await client.query(
        `UPDATE ${tM} SET anulado_at = now(), anulado_por_id = $3::uuid,
                anulado_motivo = COALESCE($4, 'Pago a proveedor anulado')
          WHERE id = $1::uuid AND empresa_id = $2::uuid AND anulado_at IS NULL`,
        [movId, empresaId, usuarioId, motivo]
      );
    }
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
