/**
 * Helpers PUROS de la galería de imágenes de producto (sin BD ni red), para
 * poder reutilizarlos en UI, server y tests unitarios.
 */

/**
 * Ordena filas de galería con la MISMA regla que `listGaleriaPg`
 * (`ORDER BY es_principal DESC, orden ASC, id ASC`): LA PRINCIPAL SIEMPRE
 * PRIMERA, luego por `orden` ascendente y `id` como desempate estable.
 * No muta el arreglo de entrada.
 */
export function ordenarConPrincipalPrimero<
  T extends { es_principal: boolean; orden: number; id: string }
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.es_principal !== b.es_principal) return a.es_principal ? -1 : 1;
    if (a.orden !== b.orden) return a.orden - b.orden;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Filtra los huérfanos que siguen SIN referencia según un Set de referencias
 * RE-CONSULTADO (segundo lookup real). Solo devuelve los que estaban en la lista
 * inicial de huérfanos y además no aparecen en el Set actualizado.
 */
export function filtrarHuerfanosSeguros(
  huerfanosIniciales: readonly string[],
  referenciadosActualizados: ReadonlySet<string>
): string[] {
  return huerfanosIniciales.filter((p) => !referenciadosActualizados.has(p));
}
