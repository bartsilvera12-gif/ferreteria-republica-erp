/**
 * Unit test de la fecha/hora de la factura autoimpresor.
 * Ejecutar:  tsx scripts/qa-factura-hora-unit.ts
 *
 * Replica la función fechaHora() de render-factura-ticket.ts, que usa la
 * conversión CANÓNICA del sistema (isoAInstanteAsuncion, UTC-3 permanente, sin
 * offset propio). Verifica el caso real VTA-008736 y bordes de medianoche
 * (la fecha calendario debe seguir la hora de PARAGUAY, no la UTC).
 */
import { isoAInstanteAsuncion } from "@/lib/fechas/calendario";

// Misma lógica que render-factura-ticket.ts:fechaHora
function fechaHora(iso: string): string {
  const asun = isoAInstanteAsuncion(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(asun);
  if (!m) return String(iso ?? "");
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

let ok = 0, fail = 0;
function t(iso: string, esperado: string, label: string) {
  const got = fechaHora(iso);
  const pass = got === esperado;
  if (pass) ok++; else fail++;
  console.log(`${pass ? "✓" : "✗"} ${label}\n     ${iso} -> "${got}"  (esperado "${esperado}")`);
}

// === Caso REAL: VTA-008736 / factura 001-002-0018484 ===
// emitida_at guardado = 2026-09-16 17:57:36 UTC  ==  14:57 en Paraguay (UTC-3)
t("2026-09-16T17:57:36.808341Z", "16/09/2026 14:57", "VTA-008736 (emitida_at real 17:57:36 UTC = 14:57 PY)");
t("2026-09-16T17:57:34.059Z",    "16/09/2026 14:57", "VTA-008736 (venta.fecha real 17:57:34 UTC = 14:57 PY)");

// === Bordes de medianoche (la FECHA debe seguir la hora PY) ===
// PY 23:30 del 16 = UTC 02:30 del 17 -> la fecha debe ser 16 (retrocede desde UTC)
t("2026-09-17T02:30:00Z", "16/09/2026 23:30", "PY 23:30 (UTC 02:30 del día siguiente) -> fecha 16");
// PY 23:59 del 16 = UTC 02:59 del 17
t("2026-09-17T02:59:00Z", "16/09/2026 23:59", "PY 23:59 (UTC 02:59 del día siguiente) -> fecha 16");
// PY 00:00 del 16 = UTC 03:00 del 16
t("2026-09-16T03:00:00Z", "16/09/2026 00:00", "medianoche PY (UTC 03:00) -> 00:00 del 16");
// PY 00:30 del 16 = UTC 03:30 del 16
t("2026-09-16T03:30:00Z", "16/09/2026 00:30", "PY 00:30 (UTC 03:30) -> 00:30 del 16");
// PY 12:00 del 16 = UTC 15:00
t("2026-09-16T15:00:00Z", "16/09/2026 12:00", "mediodía PY");

console.log(`\n${fail === 0 ? "OK" : "FALLO"} — ${ok} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
