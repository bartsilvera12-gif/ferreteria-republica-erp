"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowLeft } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import PresupuestoForm, { type PresupuestoFormInitial } from "@/components/presupuestos/PresupuestoForm";
import type { IvaTipoPresupuesto, CondicionPresupuesto } from "@/lib/presupuestos/types";

type Estado = "cargando" | "no_admin" | "convertido" | "no_encontrado" | "error" | "ok";

export default function EditarPresupuestoPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id);

  const [estado, setEstado] = useState<Estado>("cargando");
  const [numeroControl, setNumeroControl] = useState<string>("");
  const [initial, setInitial] = useState<PresupuestoFormInitial | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        // Permiso: solo admin/administrador/super_admin.
        const meRes = await fetchWithSupabaseSession("/api/usuarios/me", { cache: "no-store" });
        const me = await meRes.json().catch(() => ({}));
        if (!esRolAdminEmpresaOGlobal(me?.usuario?.rol)) {
          if (!cancel) setEstado("no_admin");
          return;
        }

        const res = await fetchWithSupabaseSession(`/api/presupuestos/${id}`, { cache: "no-store" });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j?.success === false || !j?.data?.presupuesto) {
          if (!cancel) setEstado(res.status === 404 ? "no_encontrado" : "error");
          return;
        }
        const p = j.data.presupuesto as Record<string, unknown>;
        if (String(p.estado) === "convertido") {
          if (!cancel) { setNumeroControl(String(p.numero_control ?? "")); setEstado("convertido"); }
          return;
        }

        const rows = (j.data.items ?? []) as Record<string, unknown>[];
        const ini: PresupuestoFormInitial = {
          cliente_id: p.cliente_id != null ? String(p.cliente_id) : "",
          cliente_nombre: String(p.cliente_nombre ?? ""),
          cliente_ruc: p.cliente_ruc != null ? String(p.cliente_ruc) : "",
          cliente_telefono: p.cliente_telefono != null ? String(p.cliente_telefono) : "",
          cliente_direccion: p.cliente_direccion != null ? String(p.cliente_direccion) : "",
          condicion: (p.condicion === "credito" ? "credito" : "contado") as CondicionPresupuesto,
          validez_dias: p.validez_dias != null ? String(p.validez_dias) : "",
          forma_pago: p.forma_pago != null ? String(p.forma_pago) : "",
          plazo_entrega: p.plazo_entrega != null ? String(p.plazo_entrega) : "",
          observaciones: p.observaciones != null ? String(p.observaciones) : "",
          items: rows.map((it) => ({
            producto_id: it.producto_id != null ? String(it.producto_id) : null,
            producto_nombre: String(it.producto_nombre ?? ""),
            sku: it.sku != null ? String(it.sku) : null,
            cantidad: Number(it.cantidad) || 0,
            unidad_medida: it.unidad_medida != null ? String(it.unidad_medida) : null,
            precio_unitario: Number(it.precio_unitario) || 0,
            iva_tipo: (it.iva_tipo === "5%" || it.iva_tipo === "EXENTA" ? it.iva_tipo : "10%") as IvaTipoPresupuesto,
            descuento: Number(it.descuento) || 0,
            presentacion_id: it.presentacion_id != null ? String(it.presentacion_id) : null,
            presentacion_nombre: it.presentacion_nombre != null ? String(it.presentacion_nombre) : null,
            presentacion_cantidad_base: it.presentacion_cantidad_base != null ? Number(it.presentacion_cantidad_base) : null,
          })),
        };
        if (!cancel) {
          setNumeroControl(String(p.numero_control ?? ""));
          setInitial(ini);
          setEstado("ok");
        }
      } catch {
        if (!cancel) setEstado("error");
      }
    })();
    return () => { cancel = true; };
  }, [id]);

  if (estado === "cargando") {
    return (
      <div className="flex items-center gap-2 py-16 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Cargando presupuesto…
      </div>
    );
  }

  if (estado === "ok" && initial) {
    return <PresupuestoForm mode="editar" presupuestoId={id} numeroControl={numeroControl} initial={initial} />;
  }

  const mensaje =
    estado === "no_admin" ? "Solo un administrador puede editar presupuestos."
    : estado === "convertido" ? `El presupuesto ${numeroControl} ya fue convertido en pedido/venta; no se puede editar.`
    : estado === "no_encontrado" ? "El presupuesto no existe."
    : "No se pudo cargar el presupuesto.";

  return (
    <div className="space-y-4">
      <Link href={`/presupuestos/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Volver al presupuesto
      </Link>
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{mensaje}</div>
    </div>
  );
}
