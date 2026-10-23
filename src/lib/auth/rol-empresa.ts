/**
 * Comprueba si el `rol` del catálogo (zentra_erp.usuarios) implica
 * acceso a configuración restringida (CRM, facturación, etc.).
 * Comparación case-insensitive por datos históricos o espacios.
 */
export function esRolAdminEmpresaOGlobal(rol: string | null | undefined): boolean {
  const r = (rol ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return (
    r === "admin" ||
    r === "administrador" ||
    r === "super_admin" ||
    r === "super admin" ||
    r === "superadmin"
  );
}

/** ¿El usuario pertenece al área de Ventas? (campo `usuarios.area`). */
export function esAreaVentas(area: string | null | undefined): boolean {
  return (area ?? "").trim().toLowerCase() === "ventas";
}

/** ¿El rol del usuario es "vendedor"? (algunos usuarios no tienen `area` cargada). */
export function esRolVendedor(rol: string | null | undefined): boolean {
  return (rol ?? "").trim().toLowerCase() === "vendedor";
}

/**
 * ¿Puede editar presupuestos? Los administradores de empresa/globales siempre,
 * y además la gente de Ventas (por área = ventas o por rol = vendedor), que
 * decide sobre sus propias cotizaciones.
 * El bloqueo por estado "convertido" se valida aparte (no depende del permiso).
 */
export function puedeEditarPresupuesto(
  rol: string | null | undefined,
  area: string | null | undefined
): boolean {
  return esRolAdminEmpresaOGlobal(rol) || esRolVendedor(rol) || esAreaVentas(area);
}
