/**
 * Alta de usuarios del ERP con sus permisos.
 *
 *   npx tsx scripts/crear-usuarios-ferreteria.ts           # DRY-RUN
 *   npx tsx scripts/crear-usuarios-ferreteria.ts --apply
 *
 * Modelo de permisos del sistema:
 *   - `administrador` ve TODOS los módulos activos de la empresa. No necesita
 *     filas en usuario_modulos.
 *   - El resto ve la intersección entre los módulos activos de la empresa y
 *     los suyos en usuario_modulos.
 *
 * Al entrar, si el usuario no tiene `dashboard`, el sistema lo lleva solo a la
 * primera sección a la que sí puede entrar (para un cajero, la Caja).
 */
import { Pool } from "pg";

const S = `"ferreteriarepublica"`;

interface NuevoUsuario {
  auth_id: string;
  nombre: string;
  /**
   * `usuario` es el rol neutro para accesos acotados: recibe EXACTAMENTE los
   * módulos que se le asignan. Ojo con `supervisor`: el sistema le concede
   * además los módulos de omnicanal (conversaciones, monitoreo) si están
   * activos en la empresa, aunque no se los asignes.
   */
  rol: "administrador" | "usuario" | "vendedor";
  /** Solo para roles no admin. */
  modulos: string[];
  nota: string;
}

/** Caja y Ventas son el MISMO módulo (`ventas`, se muestra como "Caja"). */
const USUARIOS: NuevoUsuario[] = [
  // ── Acceso completo ──────────────────────────────────────────────────────
  { auth_id: "d42e688b-d341-45fa-9af6-aa5b3a7f36ab", nombre: "GLADYS ESCOBAR",
    rol: "administrador", modulos: [], nota: "Completo" },
  { auth_id: "3fd5125b-52f5-429c-8b2d-3c07860e05be", nombre: "JUAN AREVALOS",
    rol: "administrador", modulos: [], nota: "Completo" },
  { auth_id: "86387853-3140-4025-8afd-d9e0330b4672", nombre: "RICARDO AREVALOS",
    rol: "administrador", modulos: [], nota: "Completo" },
  { auth_id: "67d3755c-f2c2-414c-ad58-63cbcbbfb26e", nombre: "ALBERTO BENITEZ",
    rol: "administrador", modulos: [], nota: "Completo" },

  // ── Semi completo: operación diaria sin las secciones de control ─────────
  // Queda afuera `configuracion` (usuarios, timbrado, datos de la empresa) y
  // `reportes` (reportes de gestión), que son las de control.
  { auth_id: "28f98d9a-7e43-4849-932d-018fc874ea29", nombre: "Dahiana Miranda",
    rol: "usuario",
    modulos: ["dashboard", "ventas", "inventario", "clientes", "presupuestos", "compras", "gastos"],
    nota: "Semi completo: factura, caja, ventas y stock. Sin configuración ni reportes." },

  // ── Compras + operación ──────────────────────────────────────────────────
  // "Órdenes de compra" vive dentro del módulo `compras` (junto a Proveedores).
  { auth_id: "bc97468b-2eec-4d8b-a3c5-0ebcf6382138", nombre: "David Villar",
    rol: "usuario",
    modulos: ["compras", "ventas", "inventario"],
    nota: "Compras, órdenes de compra, ventas y stock." },

  // ── Caja / Ventas ────────────────────────────────────────────────────────
  { auth_id: "3c7994da-066e-4375-aa3f-8ee16546e59e", nombre: "Pablino Caballero",
    rol: "vendedor", modulos: ["ventas"], nota: "Ventas" },
  { auth_id: "bdea35f3-f455-4d23-a71a-a1334c0adfc1", nombre: "Julio Aranda",
    rol: "vendedor", modulos: ["ventas"], nota: "Caja y ventas" },
  { auth_id: "8c735f1f-2573-4aa2-8574-1ba91e1ef210", nombre: "Thiago Sanabria",
    rol: "vendedor", modulos: ["ventas"], nota: "Caja y ventas" },
];

const has = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) { console.error("Falta SUPABASE_DB_URL"); process.exit(1); }
  const apply = has("apply");
  console.log(`Modo: ${apply ? "APLICAR" : "DRY-RUN"}\n`);
  const pool = new Pool({ connectionString: url });

  try {
    const empresa = (await pool.query(`SELECT empresa_id FROM ${S}.productos LIMIT 1`)).rows[0]?.empresa_id;
    if (!empresa) throw new Error("No se pudo determinar empresa_id.");

    // Catálogo de módulos activos de la empresa
    const mods = (await pool.query<{ id: string; slug: string; activo: boolean }>(
      `SELECT m.id, m.slug, coalesce(em.activo,false) AS activo
         FROM ${S}.modulos m
         LEFT JOIN ${S}.empresa_modulos em ON em.modulo_id = m.id`
    )).rows;
    const idPorSlug = new Map(mods.map((m) => [m.slug, m.id]));
    const activos = new Set(mods.filter((m) => m.activo).map((m) => m.slug));

    for (const u of USUARIOS) {
      const auth = (await pool.query<{ email: string }>(
        `SELECT email FROM auth.users WHERE id = $1::uuid`, [u.auth_id]
      )).rows[0];
      if (!auth) { console.log(`SALTEADO ${u.nombre}: no existe en auth`); continue; }

      const yaExiste = (await pool.query(
        `SELECT id FROM ${S}.usuarios WHERE auth_user_id = $1::uuid OR email = $2`,
        [u.auth_id, auth.email]
      )).rows[0];

      const invalidos = u.modulos.filter((s) => !activos.has(s));
      console.log(`${u.nombre.padEnd(20)} ${u.rol.padEnd(14)} ${auth.email}`);
      console.log(`   ${u.nota}`);
      console.log(`   módulos: ${u.rol === "administrador" ? "TODOS (por rol)" : u.modulos.join(", ") || "(ninguno)"}`);
      if (invalidos.length) console.log(`   OJO módulos inactivos en la empresa: ${invalidos.join(", ")}`);
      if (yaExiste) console.log(`   ya existe -> se actualiza`);

      if (!apply) { console.log(); continue; }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // id = auth_user_id, igual que el admin ya cargado.
        await client.query(
          `INSERT INTO ${S}.usuarios (id, email, nombre, rol, empresa_id, auth_user_id, activo, estado)
           VALUES ($1::uuid,$2,$3,$4,$5::uuid,$1::uuid,true,'activo')
           ON CONFLICT (id) DO UPDATE
             SET nombre = EXCLUDED.nombre, rol = EXCLUDED.rol,
                 activo = true, estado = 'activo'`,
          [u.auth_id, auth.email, u.nombre, u.rol, empresa]
        );

        // Los módulos se reescriben para que la corrida sea idempotente.
        await client.query(`DELETE FROM ${S}.usuario_modulos WHERE usuario_id = $1::uuid`, [u.auth_id]);
        for (const slug of u.modulos) {
          const mid = idPorSlug.get(slug);
          if (!mid) { console.log(`   módulo inexistente: ${slug}`); continue; }
          await client.query(
            `INSERT INTO ${S}.usuario_modulos (usuario_id, modulo_id) VALUES ($1::uuid,$2::uuid)`,
            [u.auth_id, mid]
          );
        }
        await client.query("COMMIT");
        console.log(`   OK\n`);
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        console.log(`   ERROR: ${(e as Error).message}\n`);
      } finally {
        client.release();
      }
    }

    if (!apply) console.log("DRY-RUN: no se escribió nada. Agregá --apply.");
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
