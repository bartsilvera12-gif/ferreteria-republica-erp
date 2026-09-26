-- Punto 2 — Saldo a favor / anticipos.
-- Habilita el tipo 'anticipo' en el libro mayor de crédito del cliente
-- (creditos_cliente) para registrar anticipos/sobrepagos manuales, además de
-- los tipos existentes (devolucion, consumo_venta, retiro_efectivo, ajuste, reverso).
-- Idempotente: recrea el CHECK con el conjunto ampliado.

BEGIN;

ALTER TABLE ferreteriarepublica.creditos_cliente
  DROP CONSTRAINT IF EXISTS creditos_cliente_tipo_check;

ALTER TABLE ferreteriarepublica.creditos_cliente
  ADD CONSTRAINT creditos_cliente_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'devolucion'::text,
    'consumo_venta'::text,
    'retiro_efectivo'::text,
    'ajuste'::text,
    'reverso'::text,
    'anticipo'::text
  ]));

COMMIT;
