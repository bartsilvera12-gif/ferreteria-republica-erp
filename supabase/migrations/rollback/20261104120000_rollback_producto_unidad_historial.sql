-- Rollback del historial de cambios de unidad. No toca productos ni movimientos;
-- el PATCH sigue cambiando la unidad (solo deja de registrarla).
DROP TABLE IF EXISTS ferreteriarepublica.producto_unidad_historial;
