/**
 * Anticipos / saldo a favor manual (Punto 2). Reutiliza el libro mayor
 * `creditos_cliente` y la Caja, con el mismo patrón transaccional que
 * `aplicar-saldo-venta.ts` (pool pg + lock por cliente).
 *
 *  - registrarAnticipo:   ingreso de Caja + crédito 'anticipo' (atómico).
 *  - ajustarCredito:      'ajuste' (monto con signo) o 'reverso' de un movimiento
 *                         (solo admin desde el route). Nunca borra historial.
 *  - pagarCuotaConSaldo:  consume saldo para pagar una cuota (cuentas_por_cobrar)
 *                         SIN generar un nuevo ingreso de Caja.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import {
  consumirCredito,
  getSaldoClienteForUpdate,
  registrarMovimientoCredito,
  CreditoInsuficienteError,
  round2,
} from "./creditos-pg";

export { CreditoInsuficienteError };

export class SinCajaAbiertaError extends Error {
  constructor() {
    super("No hay una caja abierta. Abrí una caja para registrar el ingreso del anticipo.");
    this.name = "SinCajaAbiertaError";
  }
}
export class CreditoOperacionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CreditoOperacionError";
    this.status = status;
  }
}

const MEDIOS_CAJA = ["efectivo", "tarjeta", "transferencia", "otro"] as const;
type MedioCaja = (typeof MEDIOS_CAJA)[number];
function medioValido(m: unknown): MedioCaja {
  return (MEDIOS_CAJA as readonly string[]).includes(String(m)) ? (String(m) as MedioCaja) : "efectivo";
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de base de datos no disponible.");
  return p;
}

// ── 1) Registrar anticipo manual (ingreso de Caja + crédito 'anticipo') ────────

export interface RegistrarAnticipoInput {
  clienteId: string;
  monto: number;
  medioPago: string;
  concepto?: string | null;
  observacion?: string | null;
  /** Si no viene, se resuelve la caja abierta de la empresa. */
  cajaId?: string | null;
  usuario: { id: string | null; nombre: string | null };
}
export interface RegistrarAnticipoResult {
  movimientoCreditoId: string;
  cajaMovimientoId: string;
  cajaId: string;
  saldoPrevio: number;
  saldoNuevo: number;
  monto: number;
  recibo: { id: string; numero_recibo: string };
}

/**
 * Inserta un recibo de dinero 'manual' DENTRO de la transacción del anticipo
 * (atómico: anticipo + caja + recibo, todo o nada). Numera REC-NNNNNN con lock
 * por empresa + reintento seguro ante colisión (índice único), sin duplicar.
 */
async function crearReciboAnticipoPg(
  client: import("pg").PoolClient,
  schema: string,
  empresaId: string,
  data: { clienteId: string; monto: number; metodoPago: string; concepto: string; observacion: string | null },
  usuario: { id: string | null; nombre: string | null }
): Promise<{ id: string; numero_recibo: string }> {
  const tR = quoteSchemaTable(schema, "recibos_dinero");
  const tCli = quoteSchemaTable(schema, "clientes");
  const cli = (await client.query(
    `SELECT empresa, nombre_contacto, nombre, ruc, documento FROM ${tCli} WHERE empresa_id=$1::uuid AND id=$2::uuid`,
    [empresaId, data.clienteId]
  )).rows[0] as Record<string, unknown> | undefined;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const nombre = cli ? (s(cli.empresa) || s(cli.nombre_contacto) || s(cli.nombre) || "Cliente") : "Cliente";
  const documento = cli ? (s(cli.ruc) || s(cli.documento) || null) : null;

  // Serializa la numeración de recibos por empresa dentro de la tx.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`recibo:${empresaId}`]);
  for (let intento = 0; intento < 6; intento++) {
    const last = (await client.query(
      `SELECT numero_recibo FROM ${tR} WHERE empresa_id=$1::uuid AND numero_recibo LIKE 'REC-%' ORDER BY numero_recibo DESC LIMIT 1`,
      [empresaId]
    )).rows[0] as { numero_recibo?: string } | undefined;
    let next = 1;
    if (last?.numero_recibo) { const m = last.numero_recibo.match(/^REC-(\d+)$/); if (m) next = parseInt(m[1], 10) + 1; }
    const numero = `REC-${String(next).padStart(6, "0")}`;
    await client.query("SAVEPOINT rec");
    try {
      const ins = (await client.query(
        `INSERT INTO ${tR} (
           empresa_id, numero_recibo, cliente_id, cliente_nombre, cliente_documento, origen,
           fecha, moneda, monto, metodo_pago, concepto, observaciones, usuario_id, usuario_nombre
         ) VALUES ($1::uuid,$2,$3::uuid,$4,$5,'manual',now(),'PYG',$6::numeric,$7,$8,$9,$10::uuid,$11)
         RETURNING id::text, numero_recibo`,
        [empresaId, numero, data.clienteId, nombre, documento, data.monto, data.metodoPago, data.concepto, data.observacion, usuario.id, usuario.nombre]
      )).rows[0];
      await client.query("RELEASE SAVEPOINT rec");
      return { id: String(ins.id), numero_recibo: String(ins.numero_recibo) };
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT rec").catch(() => {});
      if ((e as { code?: string }).code === "23505") continue; // colisión de número → reintentar
      throw e;
    }
  }
  throw new CreditoOperacionError("No se pudo generar el número de recibo del anticipo.", 500);
}

export async function registrarAnticipo(
  schemaRaw: string,
  empresaId: string,
  input: RegistrarAnticipoInput
): Promise<RegistrarAnticipoResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const monto = round2(Number(input.monto) || 0);
  if (!(monto > 0)) throw new CreditoOperacionError("El monto del anticipo debe ser mayor a cero.");
  const medio = medioValido(input.medioPago);
  const concepto = (input.concepto?.trim() || "Anticipo / saldo a favor").slice(0, 200);

  const tCM = quoteSchemaTable(schema, "caja_movimientos");
  const tCajas = quoteSchemaTable(schema, "cajas");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // Lock del crédito del cliente (serializa) + saldo actual.
    const saldoPrevio = await getSaldoClienteForUpdate(client, schema, empresaId, input.clienteId);

    // Resolver la caja abierta (una por empresa) si no vino explícita.
    let cajaId = input.cajaId ?? null;
    if (!cajaId) {
      const cq = await client.query(
        `SELECT id::text FROM ${tCajas} WHERE empresa_id=$1::uuid AND estado='abierta'
          ORDER BY fecha_apertura DESC LIMIT 1`,
        [empresaId]
      );
      cajaId = cq.rows[0]?.id ?? null;
    }
    if (!cajaId) throw new SinCajaAbiertaError();

    // Ingreso de Caja (UNA sola entrada) por el dinero recibido.
    const mov = await client.query(
      `INSERT INTO ${tCM} (
         empresa_id, caja_id, tipo, concepto, monto, medio_pago, usuario_id, observacion
       ) VALUES ($1::uuid,$2::uuid,'ingreso',$3,$4::numeric,$5,$6::uuid,$7)
       RETURNING id::text`,
      [empresaId, cajaId, concepto, monto, medio, input.usuario.id,
       input.observacion?.trim()?.slice(0, 500) || `Anticipo del cliente (saldo a favor)`]
    );
    const cajaMovId = String(mov.rows[0].id);

    // Crédito a favor (tipo 'anticipo', monto positivo), enlazado al movimiento de caja.
    const movCredId = await registrarMovimientoCredito(client, schema, empresaId, {
      clienteId: input.clienteId,
      tipo: "anticipo",
      monto: monto,
      cajaMovimientoId: cajaMovId,
      motivo: concepto,
      usuario: input.usuario,
    });
    await client.query(`UPDATE ${tCM} SET credito_cliente_id=$2::uuid WHERE id=$1::uuid`, [cajaMovId, movCredId]);

    // Recibo de recepción (atómico: misma transacción que el anticipo + caja).
    const recibo = await crearReciboAnticipoPg(client, schema, empresaId, {
      clienteId: input.clienteId, monto, metodoPago: medio, concepto,
      observacion: input.observacion?.trim()?.slice(0, 500) || null,
    }, input.usuario);

    await client.query("COMMIT");
    return {
      movimientoCreditoId: movCredId,
      cajaMovimientoId: cajaMovId,
      cajaId,
      saldoPrevio,
      saldoNuevo: round2(saldoPrevio + monto),
      monto,
      recibo,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── 2) Ajuste / reverso (solo admin desde el route) ────────────────────────────

export interface AjustarCreditoInput {
  clienteId: string;
  /** 'ajuste' usa `monto` con signo; 'reverso' revierte el movimiento `movimientoId`. */
  modo: "ajuste" | "reverso";
  monto?: number;
  movimientoId?: string;
  motivo?: string | null;
  usuario: { id: string | null; nombre: string | null };
}
export interface AjustarCreditoResult {
  movimientoId: string;
  saldoPrevio: number;
  saldoNuevo: number;
  monto: number;
}

export async function ajustarCredito(
  schemaRaw: string,
  empresaId: string,
  input: AjustarCreditoInput
): Promise<AjustarCreditoResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tCC = quoteSchemaTable(schema, "creditos_cliente");
  const tCM = quoteSchemaTable(schema, "caja_movimientos");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const saldoPrevio = await getSaldoClienteForUpdate(client, schema, empresaId, input.clienteId);

    let monto: number;
    let motivo: string;
    let tipo: "ajuste" | "reverso";
    /** Movimiento de caja a anular (solo cuando se revierte un 'anticipo'). */
    let cajaMovIdAnular: string | null = null;

    if (input.modo === "reverso") {
      if (!input.movimientoId) throw new CreditoOperacionError("Falta el movimiento a revertir.");
      const orig = await client.query(
        `SELECT monto, tipo, caja_movimiento_id::text AS caja_movimiento_id FROM ${tCC}
          WHERE id=$1::uuid AND empresa_id=$2::uuid AND cliente_id=$3::uuid`,
        [input.movimientoId, empresaId, input.clienteId]
      );
      if (orig.rows.length === 0) throw new CreditoOperacionError("Movimiento no encontrado.", 404);
      const origTipo = String(orig.rows[0].tipo);
      // Solo se pueden revertir desde acá movimientos manuales sin operaciones
      // asociadas (anticipo, ajuste). devolucion/consumo_venta/retiro_efectivo
      // tienen una venta/devolución/retiro detrás y se corrigen en su módulo.
      if (!["anticipo", "ajuste"].includes(origTipo)) {
        throw new CreditoOperacionError(
          `No se puede revertir un movimiento de tipo '${origTipo}' desde acá: tiene una operación asociada (venta/devolución/retiro).`,
          409
        );
      }
      const original = round2(Number(orig.rows[0].monto) || 0);
      monto = round2(-original); // revierte el signo
      tipo = "reverso";
      motivo = (input.motivo?.trim() || `Reverso del movimiento ${input.movimientoId}`).slice(0, 300);
      // Si es un anticipo, también hay que revertir su ingreso de Caja.
      if (origTipo === "anticipo" && orig.rows[0].caja_movimiento_id) {
        cajaMovIdAnular = String(orig.rows[0].caja_movimiento_id);
      }
    } else {
      monto = round2(Number(input.monto) || 0);
      if (monto === 0) throw new CreditoOperacionError("El ajuste no puede ser cero.");
      tipo = "ajuste";
      motivo = (input.motivo?.trim() || "Ajuste manual de saldo").slice(0, 300);
    }

    // No permitir dejar el saldo negativo (el crédito ya utilizado no se puede revertir/ajustar a menos).
    if (monto < 0 && round2(saldoPrevio + monto) < -1e-9) {
      throw new CreditoOperacionError(
        `No se puede: el saldo quedaría negativo (disponible ${Math.round(saldoPrevio).toLocaleString("es-PY")}).`,
        409
      );
    }

    const movId = await registrarMovimientoCredito(client, schema, empresaId, {
      clienteId: input.clienteId,
      tipo,
      monto,
      motivo,
      usuario: input.usuario,
    });

    // Anular (soft) el ingreso de Caja del anticipo revertido — misma transacción,
    // sin borrar el movimiento (queda tachado, con auditoría). Idempotente.
    if (cajaMovIdAnular) {
      await client.query(
        `UPDATE ${tCM} SET anulado_at=now(), anulado_por_id=$2::uuid,
                anulado_motivo=$3
          WHERE id=$1::uuid AND empresa_id=$4::uuid AND anulado_at IS NULL`,
        [cajaMovIdAnular, input.usuario.id, `Reverso de anticipo (crédito ${input.movimientoId})`.slice(0, 500), empresaId]
      );
    }

    await client.query("COMMIT");
    return { movimientoId: movId, saldoPrevio, saldoNuevo: round2(saldoPrevio + monto), monto };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── 3) Pagar una cuota (cuenta por cobrar) con saldo a favor — sin ingreso de Caja ─

export interface PagarCuotaConSaldoInput {
  clienteId: string;
  cuentaPorCobrarId: string;
  monto: number;
  usuario: { id: string | null; nombre: string | null };
}
export interface PagarCuotaConSaldoResult {
  cobroId: string;
  saldoCuentaNuevo: number;
  estadoCuenta: string;
  saldoCreditoNuevo: number;
}

export async function pagarCuotaConSaldo(
  schemaRaw: string,
  empresaId: string,
  input: PagarCuotaConSaldoInput
): Promise<PagarCuotaConSaldoResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tCXC = quoteSchemaTable(schema, "cuentas_por_cobrar");
  const tCob = quoteSchemaTable(schema, "cobros_clientes");
  const monto = round2(Number(input.monto) || 0);
  if (!(monto > 0)) throw new CreditoOperacionError("El monto a pagar debe ser mayor a cero.");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // Lock del crédito del cliente + saldo.
    const saldoCredito = await getSaldoClienteForUpdate(client, schema, empresaId, input.clienteId);

    // Cuenta por cobrar bloqueada.
    const cq = await client.query(
      `SELECT id::text, cliente_id::text AS cliente_id, venta_id::text AS venta_id,
              numero_venta, total, saldo, estado
         FROM ${tCXC} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`,
      [input.cuentaPorCobrarId, empresaId]
    );
    if (cq.rows.length === 0) throw new CreditoOperacionError("Cuenta por cobrar no encontrada.", 404);
    const cxc = cq.rows[0];
    if (String(cxc.cliente_id) !== input.clienteId)
      throw new CreditoOperacionError("La cuenta no pertenece a este cliente.", 409);
    if (cxc.estado === "anulado") throw new CreditoOperacionError("La cuenta está anulada.", 409);
    if (cxc.estado === "pagado") throw new CreditoOperacionError("La cuenta ya está pagada.", 409);

    const saldoActual = round2(Number(cxc.saldo) || 0);
    const total = round2(Number(cxc.total) || 0);
    if (monto > saldoActual + 0.001)
      throw new CreditoOperacionError(`El monto (${monto}) supera el saldo de la cuenta (${saldoActual}).`);
    if (monto > saldoCredito + 1e-9) throw new CreditoInsuficienteError(saldoCredito, monto);

    // 1) Consumir el saldo a favor (NO genera ingreso de caja).
    await consumirCredito(client, schema, empresaId, {
      clienteId: input.clienteId,
      monto,
      ventaId: cxc.venta_id,
      tipo: "consumo_venta",
      motivo: `Pago de cuota ${cxc.numero_venta ?? ""} con saldo a favor`.trim(),
      usuario: input.usuario,
    });

    // 2) Registrar el cobro (metodo 'saldo_favor'), sin tocar caja.
    const ins = await client.query(
      `INSERT INTO ${tCob} (
         empresa_id, cliente_id, cuenta_por_cobrar_id, venta_id, fecha_pago, monto,
         metodo_pago, observaciones, usuario_id, usuario_nombre
       ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,now(),$5::numeric,'saldo_favor',$6,$7::uuid,$8)
       RETURNING id::text`,
      [empresaId, input.clienteId, cxc.id, cxc.venta_id, monto,
       "Pago con saldo a favor del cliente", input.usuario.id, input.usuario.nombre]
    );
    const cobroId = String(ins.rows[0].id);

    // 3) Recalcular saldo/estado de la cuenta.
    const saldoNuevo = round2(saldoActual - monto);
    const estadoNuevo = saldoNuevo <= 0.001 ? "pagado" : saldoNuevo < total ? "parcial" : "pendiente";
    await client.query(
      `UPDATE ${tCXC} SET saldo=$2::numeric, estado=$3, updated_at=now() WHERE id=$1::uuid AND empresa_id=$4::uuid`,
      [cxc.id, saldoNuevo < 0 ? 0 : saldoNuevo, estadoNuevo, empresaId]
    );

    await client.query("COMMIT");
    return {
      cobroId,
      saldoCuentaNuevo: saldoNuevo < 0 ? 0 : saldoNuevo,
      estadoCuenta: estadoNuevo,
      saldoCreditoNuevo: round2(saldoCredito - monto),
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
