/**
 * Aplica el saldo a favor de un cliente a una venta.
 *
 * Se ejecuta en UNA transacción propia, con lock por cliente, para que dos cajas
 * no puedan gastar el mismo saldo. Contempla dos cosas:
 *
 *   - `usar`:    parte (o todo) del saldo que paga la venta.
 *   - `retirar`: excedente que el cliente pide llevarse EN EFECTIVO (egreso de
 *                caja). Solo si sobra saldo después de pagar.
 *
 * Si algo falla, la transacción se revierte entera: no queda saldo consumido a
 * medias ni movimiento de caja huérfano.
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

export class SaldoSinCajaError extends Error {
  constructor() {
    super("No hay una caja abierta. Abrí una caja para entregar el excedente en efectivo.");
    this.name = "SaldoSinCajaError";
  }
}
export { CreditoInsuficienteError };

export interface AplicarSaldoInput {
  clienteId: string;
  ventaId: string;
  ventaNumero: string;
  /** Monto del saldo que paga la venta (0 si no se usa). */
  usar: number;
  /** Excedente a entregar en efectivo (0 si no se retira). */
  retirar: number;
  cajaId: string | null;
  usuario: { id: string | null; nombre: string | null };
}

export interface AplicarSaldoResult {
  usado: number;
  retirado: number;
  saldoPrevio: number;
  saldoNuevo: number;
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de base de datos no disponible.");
  return p;
}

export async function aplicarSaldoAVenta(
  schemaRaw: string,
  empresaId: string,
  input: AplicarSaldoInput
): Promise<AplicarSaldoResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const usar = round2(Math.max(0, input.usar));
  const retirar = round2(Math.max(0, input.retirar));
  if (usar <= 0 && retirar <= 0) {
    return { usado: 0, retirado: 0, saldoPrevio: 0, saldoNuevo: 0 };
  }

  const tCM = quoteSchemaTable(schema, "caja_movimientos");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // Lock + saldo actual. Valida que alcance para TODO lo pedido.
    const saldoPrevio = await getSaldoClienteForUpdate(client, schema, empresaId, input.clienteId);
    const totalPedido = round2(usar + retirar);
    if (totalPedido > saldoPrevio + 1e-9) {
      throw new CreditoInsuficienteError(saldoPrevio, totalPedido);
    }
    // Retirar efectivo exige caja abierta: sale plata del cajón.
    if (retirar > 0 && !input.cajaId) throw new SaldoSinCajaError();

    if (usar > 0) {
      await consumirCredito(client, schema, empresaId, {
        clienteId: input.clienteId,
        monto: usar,
        ventaId: input.ventaId,
        tipo: "consumo_venta",
        motivo: `Pago de la venta ${input.ventaNumero} con saldo a favor`,
        usuario: input.usuario,
      });
    }

    if (retirar > 0 && input.cajaId) {
      const mov = await client.query(
        `INSERT INTO ${tCM} (
           empresa_id, caja_id, tipo, concepto, monto, medio_pago, usuario_id, observacion, venta_id
         ) VALUES ($1::uuid,$2::uuid,'egreso',$3,$4,'efectivo',$5::uuid,$6,$7::uuid)
         RETURNING id::text`,
        [
          empresaId, input.cajaId,
          "Retiro de saldo a favor en efectivo",
          retirar, input.usuario.id,
          `Excedente de saldo entregado al cliente · venta ${input.ventaNumero}`,
          input.ventaId,
        ]
      );
      const cajaMovId = String(mov.rows[0].id);
      const movCredId = await registrarMovimientoCredito(client, schema, empresaId, {
        clienteId: input.clienteId,
        tipo: "retiro_efectivo",
        monto: -retirar,
        ventaId: input.ventaId,
        cajaMovimientoId: cajaMovId,
        motivo: `Retiro en efectivo del excedente · venta ${input.ventaNumero}`,
        usuario: input.usuario,
      });
      await client.query(
        `UPDATE ${tCM} SET credito_cliente_id = $2::uuid WHERE id = $1::uuid`,
        [cajaMovId, movCredId]
      );
    }

    await client.query("COMMIT");
    return {
      usado: usar,
      retirado: retirar,
      saldoPrevio,
      saldoNuevo: round2(saldoPrevio - usar - retirar),
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
