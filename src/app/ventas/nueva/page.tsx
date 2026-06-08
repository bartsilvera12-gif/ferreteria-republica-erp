"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MontoInput from "@/components/ui/MontoInput";
import ProductPickerModal, { type ProductoPickerItem, type AgregarVentaPayload } from "@/components/inventario/ProductPickerModal";
import { saveVenta } from "@/lib/ventas/storage";
import { getProductos } from "@/lib/inventario/storage";
import type { TipoIvaVenta, TipoVenta, MonedaVenta, LineaVenta, MetodoPago, TipoPrecioVenta } from "@/lib/ventas/types";
import type { Producto } from "@/lib/inventario/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

function calcIva(tipo: TipoIvaVenta, base: number) {
  if (tipo === "EXENTA") return 0;
  if (tipo === "5%")     return base * 0.05;
  return base * 0.10;
}

/**
 * Precio unitario (Gs.) según el tipo elegido, con fallbacks:
 *  minorista → precio_venta;
 *  mayorista → precio_mayorista (>0) o fallback a precio_venta;
 *  costo     → costo_promedio.
 */
function precioPorTipo(p: Producto, tipo: TipoPrecioVenta): number {
  if (tipo === "mayorista") return p.precio_mayorista != null && p.precio_mayorista > 0 ? p.precio_mayorista : p.precio_venta;
  if (tipo === "distribuidor") return p.precio_distribuidor != null && p.precio_distribuidor > 0 ? p.precio_distribuidor : p.precio_venta;
  if (tipo === "costo") return p.costo_promedio ?? 0; // histórico: ya no se ofrece en la UI
  return p.precio_venta;
}

/** Tipos de precio ofrecidos en la UI (sin 'costo', que queda solo como histórico). */
const TIPOS_PRECIO_UI: TipoPrecioVenta[] = ["minorista", "mayorista", "distribuidor"];

const tipoPrecioLabel: Record<TipoPrecioVenta, string> = {
  minorista: "Minorista",
  mayorista: "Mayorista",
  distribuidor: "Distribuidor",
  costo: "Al costo",
};

// ── Estilos ────────────────────────────────────────────────────────────────────

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const labelClass = "block text-sm font-medium text-slate-700 mb-1.5";

// ── Sub-componentes ───────────────────────────────────────────────────────────

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex border border-slate-200 rounded-lg overflow-hidden ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            value === opt.value
              ? "bg-[#0EA5E9] text-white"
              : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
      {children}
    </p>
  );
}

const ivaLabel: Record<TipoIvaVenta, string> = {
  EXENTA: "Exenta",
  "5%":   "5%",
  "10%":  "10%",
};

// ── Componente principal ───────────────────────────────────────────────────────

export default function NuevaVentaPage() {
  const router = useRouter();

  // ── Estado global ──────────────────────────────────────────────────────────
  const [productos, setProductos]   = useState<Producto[]>([]);
  const [items, setItems]           = useState<LineaVenta[]>([]);
  const [errorLinea, setErrorLinea] = useState<string | null>(null);
  const [errorVenta, setErrorVenta] = useState<string | null>(null);

  // ── Condiciones de la venta ───────────────────────────────────────────────
  // Instancia dedicada: siempre Guaraníes.
  const moneda: MonedaVenta = "GS";

  // Contado / Crédito (campos ya existentes en `ventas`: tipo_venta + plazo_dias).
  const [tipoVenta, setTipoVenta] = useState<TipoVenta>("CONTADO");
  const [plazoDias, setPlazoDias] = useState("");

  // Cliente (opcional). Si se selecciona, se envía cliente_id al crear la venta.
  type ClienteLite = { id: string; label: string; ruc: string | null };
  const [clientes, setClientes] = useState<ClienteLite[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [clienteQuery, setClienteQuery] = useState("");
  const [clienteOpen, setClienteOpen] = useState(false);
  const clienteContainerRef = useRef<HTMLDivElement>(null);

  // ── Cobro (solo CONTADO, no se persiste — solo ayuda al cajero) ───────────
  const [montoRecibido, setMontoRecibido] = useState("");
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("efectivo");

  // ── Detalle de cobro (conciliación bancaria) ──────────────────────────────
  const [entidades, setEntidades] = useState<{ id: string; nombre: string; tipo: string | null }[]>([]);
  const [pagoEntidadId, setPagoEntidadId] = useState("");
  const [pagoReferencia, setPagoReferencia] = useState("");
  const [pagoObservacion, setPagoObservacion] = useState("");

  // ── Línea en construcción ─────────────────────────────────────────────────
  const [lineaProdId, setLineaProdId] = useState("");
  const [lineaCant,   setLineaCant]   = useState("");
  const [lineaPrecio, setLineaPrecio] = useState("");
  const [lineaIva,    setLineaIva]    = useState<TipoIvaVenta>("10%");
  const [lineaTipoPrecio, setLineaTipoPrecio] = useState<TipoPrecioVenta>("minorista");

  // ── Combobox de producto ───────────────────────────────────────────────────
  const [comboQuery,     setComboQuery]     = useState("");
  const [comboOpen,      setComboOpen]      = useState(false);
  const [comboHighlight, setComboHighlight] = useState(-1);
  const comboInputRef    = useRef<HTMLInputElement>(null);
  const comboContainerRef = useRef<HTMLDivElement>(null);

  // ── Modal buscador (F3) ────────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);

  function pickerToProducto(p: ProductoPickerItem): Producto {
    return {
      id: p.id,
      nombre: p.nombre,
      sku: p.sku,
      precio_venta: p.precio_venta,
      precio_mayorista: p.precio_mayorista ?? null,
      precio_distribuidor: p.precio_distribuidor ?? null,
      stock_actual: p.stock_actual,
      unidad_medida: p.unidad_medida,
      costo_promedio: p.costo_promedio ?? 0,
      stock_minimo: 0,
      metodo_valuacion: "CPP",
      codigo_barras: p.codigo_barras,
      codigo_barras_interno: p.codigo_barras_interno,
      imagen_path: null,
      imagen_url: p.imagen_url,
    };
  }

  function handleSelectFromPicker(p: ProductoPickerItem) {
    const prod = pickerToProducto(p);
    setProductos((prev) => (prev.find((x) => x.id === prod.id) ? prev : [...prev, prod]));
    seleccionarProducto(prod);
    setPickerOpen(false);
  }

  /**
   * Agregado directo desde el modal: arma la LineaVenta usando la misma
   * logica que handleAgregarLinea pero con datos del modal, sin pasar
   * por el form inline. Mantiene el modal abierto si todo OK.
   */
  function handleAgregarDesdePicker(payload: AgregarVentaPayload): boolean {
    const { producto: p, cantidad, precio_input, iva, tipo_precio } = payload;
    const precioPyg = precio_input;
    // Verificar stock vs lo ya cargado SOLO si el producto controla stock.
    // Productos del Menú (controla_stock=false) no validan stock.
    const ctrlStock = (p as { controla_stock?: boolean }).controla_stock !== false;
    if (ctrlStock) {
      const yaEnCarrito = items.filter((i) => i.producto_id === p.id).reduce((s, i) => s + i.cantidad, 0);
      const disp = p.stock_actual - yaEnCarrito;
      if (cantidad > disp) {
        return false;
      }
    }
    const subtotal = cantidad * precioPyg;
    const montoIva = calcIva(iva, subtotal);
    const totalLinea = subtotal + montoIva;

    // Asegurar que el producto este en el array local (para que stock_actual
    // se conozca en validaciones posteriores del form inline).
    const prodLocal = pickerToProducto(p);
    setProductos((prev) => (prev.find((x) => x.id === prodLocal.id) ? prev : [...prev, prodLocal]));

    setItems((prev) => [
      ...prev,
      {
        producto_id: p.id,
        producto_nombre: p.nombre,
        sku: p.sku,
        cantidad,
        precio_venta_original: precio_input,
        precio_venta: precioPyg,
        tipo_iva: iva,
        tipo_precio,
        subtotal,
        monto_iva: montoIva,
        total_linea: totalLinea,
      },
    ]);
    setErrorVenta(null);
    return true;
  }

  useEffect(() => {
    let cancelled = false;
    getProductos().then((data) => {
      if (!cancelled) setProductos(data);
    });
    return () => { cancelled = true; };
  }, []);

  // Cargar entidades bancarias (caja/banco/tarjeta/billetera) para el detalle de cobro.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/entidades-bancarias", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j?.success) setEntidades(j.data?.entidades ?? []); })
      .catch(() => { /* no bloquea la venta si falla */ });
    return () => { cancelled = true; };
  }, []);

  // Cargar clientes (buscador opcional de cliente en la venta).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/clientes", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.success || !Array.isArray(j.data)) return;
        const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
        const lite: ClienteLite[] = (j.data as Record<string, unknown>[]).map((r) => ({
          id: String(r.id),
          label: s(r.empresa) || s(r.nombre_contacto) || s(r.nombre) || "Cliente",
          ruc: s(r.ruc) || null,
        }));
        setClientes(lite);
      })
      .catch(() => { /* el buscador de cliente es opcional, no bloquea la venta */ });
    return () => { cancelled = true; };
  }, []);

  // UX rápida: abrir el buscador de productos al entrar (carrito vacío).
  // Si el usuario lo cierra, sigue usando el formulario normal (no queda atrapado).
  useEffect(() => {
    setPickerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboContainerRef.current && !comboContainerRef.current.contains(e.target as Node)) {
        setComboOpen(false);
      }
      if (clienteContainerRef.current && !clienteContainerRef.current.contains(e.target as Node)) {
        setClienteOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll a la opción destacada en el dropdown
  useEffect(() => {
    if (comboHighlight >= 0) {
      document.getElementById(`combo-opt-${comboHighlight}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [comboHighlight]);

  // ── Cálculos ───────────────────────────────────────────────────────────────
  const tipoCambioNum = 1;

  const prodSel     = productos.find((p) => p.id === lineaProdId);
  const cantNum     = parseInt(lineaCant) || 0;
  const precioInput = parseFloat(lineaPrecio) || 0;
  const precioGs    = precioInput;

  const enCarrito = items
    .filter((i) => i.producto_id === lineaProdId)
    .reduce((s, i) => s + i.cantidad, 0);
  const prodSelControlaStock = prodSel ? prodSel.controla_stock !== false : true;
  const stockDisp = (prodSel?.stock_actual ?? 0) - enCarrito;

  const lineaSubtotal   = cantNum > 0 && precioGs > 0 ? cantNum * precioGs : 0;
  const lineaMontoIva   = calcIva(lineaIva, lineaSubtotal);
  const lineaTotalLinea = lineaSubtotal + lineaMontoIva;

  // Solo validar stock para productos que lo controlan (Reventa).
  // Productos del Menú (controla_stock=false) se venden sin restricción de stock.
  const stockInsuf  = prodSel !== undefined && prodSelControlaStock && cantNum > 0 && cantNum > stockDisp;
  const lineaValida =
    !!prodSel && cantNum > 0 && precioGs > 0 && !stockInsuf;

  const totalSubtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const totalIva      = items.reduce((s, i) => s + i.monto_iva, 0);
  const totalGeneral  = items.reduce((s, i) => s + i.total_linea, 0);
  // Condición de venta: si es Crédito, exigir plazo de al menos 1 día.
  const plazoDiasNum = parseInt(plazoDias) || 0;
  const creditoValido = tipoVenta === "CONTADO" || plazoDiasNum >= 1;
  const ventaValida   = items.length > 0 && creditoValido;

  // Cliente (opcional) — selección + filtrado del buscador.
  const clienteSel = clientes.find((c) => c.id === clienteId) ?? null;
  const clientesFiltrados = (clienteQuery.trim() === ""
    ? clientes
    : clientes.filter((c) => {
        const q = clienteQuery.toLowerCase();
        return c.label.toLowerCase().includes(q) || (c.ruc ?? "").toLowerCase().includes(q);
      })
  ).slice(0, 50);

  // Vuelto (solo informativo, no se persiste)
  const montoRecibidoNum = parseFloat(montoRecibido) || 0;
  const vuelto           = montoRecibidoNum - totalGeneral;

  // ── Productos filtrados para el combobox ──────────────────────────────────
  // Solo vendibles (Reventa + Menú). Excluye materia prima / insumos.
  const productosVendibles = productos.filter((p) => p.es_vendible !== false);
  const comboFiltrados = comboQuery.trim() === ""
    ? productosVendibles
    : productosVendibles.filter((p) => {
        const q = comboQuery.toLowerCase();
        return p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      });

  // ── Selección de un producto desde el combobox ────────────────────────────
  function seleccionarProducto(p: Producto) {
    setLineaProdId(String(p.id));
    setLineaTipoPrecio("minorista");
    setLineaPrecio(String(precioPorTipo(p, "minorista")));
    setLineaCant("1");
    setLineaIva("10%");
    setComboQuery(`${p.nombre} — ${p.sku}`);
    setComboOpen(false);
    setComboHighlight(-1);
    setErrorLinea(null);
  }

  /** Cambia el tipo de precio de la línea en construcción y ajusta el precio unitario. */
  function handleLineaTipoPrecio(tipo: TipoPrecioVenta) {
    setLineaTipoPrecio(tipo);
    if (prodSel) setLineaPrecio(String(precioPorTipo(prodSel, tipo)));
    setErrorLinea(null);
  }

  // ── Handlers del combobox ─────────────────────────────────────────────────
  function handleComboInput(e: React.ChangeEvent<HTMLInputElement>) {
    setComboQuery(e.target.value);
    setComboOpen(true);
    setComboHighlight(-1);
    // Si el usuario borra el texto, limpiar la selección
    if (e.target.value === "") {
      setLineaProdId("");
      setLineaPrecio("");
      setLineaCant("");
    }
    setErrorLinea(null);
  }

  function handleComboKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setComboOpen(true);
      setComboHighlight((h) => Math.min(h + 1, comboFiltrados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setComboHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (comboOpen && comboHighlight >= 0 && comboFiltrados[comboHighlight]) {
        // Seleccionar el ítem destacado del dropdown
        seleccionarProducto(comboFiltrados[comboHighlight]);
      } else if (!comboOpen && lineaValida) {
        // Dropdown cerrado + producto válido → agregar al carrito
        handleAgregarLinea();
      }
    } else if (e.key === "Escape") {
      setComboOpen(false);
      setComboHighlight(-1);
    }
  }

  // ── Agregar línea al carrito ──────────────────────────────────────────────
  function handleAgregarLinea() {
    setErrorLinea(null);
    if (!prodSel)          return setErrorLinea("Seleccioná un producto.");
    if (cantNum <= 0)      return setErrorLinea("La cantidad debe ser mayor a 0.");
    if (precioGs <= 0)     return setErrorLinea("El precio de venta debe ser mayor a 0.");
    if (stockInsuf)
      return setErrorLinea(
        `Stock insuficiente para "${prodSel.nombre}". Disponible: ${stockDisp} u.`
      );

    setItems((prev) => [
      ...prev,
      {
        producto_id:           prodSel.id,
        producto_nombre:       prodSel.nombre,
        sku:                   prodSel.sku,
        cantidad:              cantNum,
        precio_venta_original: precioInput,
        precio_venta:          precioGs,
        tipo_iva:              lineaIva,
        tipo_precio:           lineaTipoPrecio,
        subtotal:              lineaSubtotal,
        monto_iva:             lineaMontoIva,
        total_linea:           lineaTotalLinea,
      },
    ]);

    // Limpiar línea y devolver foco al buscador de producto
    setLineaProdId("");
    setLineaCant("");
    setLineaPrecio("");
    setLineaIva("10%");
    setLineaTipoPrecio("minorista");
    setComboQuery("");
    setComboOpen(false);
    setTimeout(() => comboInputRef.current?.focus(), 0);
  }

  function handleEliminarLinea(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorVenta(null);
    if (!ventaValida) return;

    const resultado = await saveVenta(
      {
        items,
        moneda,
        tipo_cambio:  tipoCambioNum,
        subtotal:     totalSubtotal,
        monto_iva:    totalIva,
        total:        totalGeneral,
        tipo_venta:   tipoVenta,
        plazo_dias:   tipoVenta === "CREDITO" ? plazoDiasNum : undefined,
        metodo_pago:  metodoPago,
        cliente_id:   clienteId || null,
      },
      undefined,
      {
        entidad_bancaria_id: pagoEntidadId || null,
        entidad_nombre_snapshot: entidades.find((e) => e.id === pagoEntidadId)?.nombre ?? null,
        referencia: pagoReferencia.trim() || null,
        observacion: pagoObservacion.trim() || null,
      }
    );

    if (!resultado.success) {
      setErrorVenta(resultado.error);
      return;
    }
    // Abrir comandas + ticket cliente en nueva pestaña con autoprint.
    try {
      window.open(`/api/ventas/${resultado.venta.id}/ticket?mode=comandas&auto=1`, "_blank", "noopener");
    } catch {}
    router.push("/ventas");
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Nueva venta</h1>
        <p className="text-gray-600">
          Agregá productos de reventa o del catálogo. Al confirmar se registra la venta.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-7xl">

        {/* ── SECCIÓN 0: Datos de la venta (cliente opcional + condición) ────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6">
          <SectionTitle>Datos de la venta</SectionTitle>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

            {/* Cliente (opcional) */}
            <div ref={clienteContainerRef} className="relative">
              <label className={labelClass}>
                Cliente <span className="text-xs font-normal text-gray-400">(opcional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={clienteSel ? clienteSel.label : clienteQuery}
                  onChange={(e) => { setClienteId(""); setClienteQuery(e.target.value); setClienteOpen(true); }}
                  onFocus={() => setClienteOpen(true)}
                  placeholder="Buscar por nombre o RUC…"
                  className={`${inputClass} ${clienteSel ? "font-medium" : ""}`}
                />
                {clienteSel && (
                  <button
                    type="button"
                    onClick={() => { setClienteId(""); setClienteQuery(""); }}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 text-xs text-slate-500 hover:bg-slate-50"
                  >
                    Quitar
                  </button>
                )}
              </div>
              {clienteOpen && !clienteSel && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {clientesFiltrados.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400">Sin clientes que coincidan.</p>
                  ) : (
                    clientesFiltrados.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setClienteId(c.id); setClienteQuery(""); setClienteOpen(false); }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        <span className="font-medium text-gray-800">{c.label}</span>
                        {c.ruc && <span className="ml-2 text-xs text-gray-400">RUC {c.ruc}</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
              <p className="mt-1 text-[11px] text-gray-400">
                Si no seleccionás cliente, la venta se registra sin cliente.
              </p>
            </div>

            {/* Condición: Contado / Crédito */}
            <div>
              <label className={labelClass}>Condición</label>
              <SegmentedControl<TipoVenta>
                value={tipoVenta}
                options={[
                  { value: "CONTADO", label: "Contado" },
                  { value: "CREDITO", label: "Crédito" },
                ]}
                onChange={(v) => { setTipoVenta(v); if (v === "CONTADO") setPlazoDias(""); }}
              />
              {tipoVenta === "CREDITO" && (
                <div className="mt-3">
                  <label className={labelClass}>Plazo de crédito (días)</label>
                  <input
                    type="number"
                    min={1}
                    value={plazoDias}
                    onChange={(e) => setPlazoDias(e.target.value)}
                    placeholder="Ej: 30"
                    className={`${inputClass} ${plazoDiasNum < 1 ? "border-red-300 bg-red-50" : ""}`}
                  />
                  {plazoDiasNum < 1 && (
                    <p className="mt-1 text-[11px] text-red-600">Ingresá un plazo de al menos 1 día.</p>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── SECCIÓN 1: Agregar producto ───────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6">
          <SectionTitle>Agregar producto</SectionTitle>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-end">

            {/* ── Combobox con búsqueda — 4 cols ────────────────────────────── */}
            <div className="lg:col-span-4" ref={comboContainerRef}>
              <label className={labelClass}>
                Producto
                <span className="ml-1 text-gray-400 font-normal normal-case tracking-normal text-xs">
                  — escribí o usá el buscador
                </span>
              </label>

              {/* Input de búsqueda + botón modal */}
              <div className="flex gap-2">
               <div className="relative flex-1">
                <input
                  ref={comboInputRef}
                  type="text"
                  value={comboQuery}
                  readOnly
                  onFocus={() => setPickerOpen(true)}
                  onClick={() => setPickerOpen(true)}
                  placeholder="Click para abrir buscador — nombre, SKU, código, categoría, ubicación..."
                  autoComplete="off"
                  className={`${inputClass} pr-8 cursor-pointer bg-white`}
                />
                {/* Icono chevron */}
                <svg
                  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                  className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                >
                  <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>

                {/* Dropdown */}
                {comboOpen && comboFiltrados.length > 0 && (
                  <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1">
                    {comboFiltrados.map((p, idx) => {
                      const enCarro    = items.filter(i => i.producto_id === p.id).reduce((s, i) => s + i.cantidad, 0);
                      const ctrl       = p.controla_stock !== false;
                      const disponible = p.stock_actual - enCarro;
                      const sinStock   = ctrl && disponible <= 0;
                      const isMenuItem = !ctrl;
                      const isActive   = idx === comboHighlight;
                      return (
                        <li
                          key={p.id}
                          id={`combo-opt-${idx}`}
                          onMouseDown={(e) => { e.preventDefault(); if (!sinStock) seleccionarProducto(p); }}
                          onMouseEnter={() => !sinStock && setComboHighlight(idx)}
                          className={`px-3 py-2.5 text-sm cursor-pointer
                            ${sinStock ? "opacity-40 cursor-not-allowed" : ""}
                            ${isActive && !sinStock ? "bg-[#0EA5E9] text-white" : "hover:bg-slate-50"}
                          `}
                        >
                          <span className="font-medium">{p.nombre}</span>
                          <span className={`ml-2 text-xs ${isActive ? "text-gray-300" : "text-gray-400"}`}>
                            — {p.sku}
                          </span>
                          {sinStock && (
                            <span className="ml-2 text-xs text-red-400 font-medium">SIN STOCK</span>
                          )}
                          {isMenuItem && (
                            <span className={`ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20 text-white" : "bg-amber-100 text-amber-800"}`}>Menú</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Sin resultados */}
                {comboOpen && comboQuery.trim() !== "" && comboFiltrados.length === 0 && (
                  <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-3 text-sm text-gray-400">
                    Sin resultados para &ldquo;{comboQuery}&rdquo;
                  </div>
                )}
               </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  title="Abrir buscador avanzado (catálogo completo, con imagen)"
                  className="shrink-0 inline-flex items-center justify-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 rounded-lg text-sm font-medium transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
                  </svg>
                  Buscar
                </button>
              </div>

              {/* Info del producto seleccionado */}
              {prodSel && (
                <div className="mt-1.5 flex gap-3 text-xs text-gray-500">
                  <span>Precio: <strong>{formatGs(prodSel.precio_venta)}</strong></span>
                  {prodSelControlaStock ? (
                    <span>Disp: <strong className={stockDisp <= 0 ? "text-red-600" : "text-gray-700"}>
                      {stockDisp} u.
                    </strong></span>
                  ) : (
                    <span><span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 font-medium px-2 py-0.5">Menú</span></span>
                  )}
                </div>
              )}
            </div>

            {/* Cantidad — 2 cols */}
            <div className="lg:col-span-2">
              <label className={labelClass}>Cantidad</label>
              <input
                type="number"
                value={lineaCant}
                onChange={(e) => { setErrorLinea(null); setLineaCant(e.target.value); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAgregarLinea(); }}}
                placeholder="Cant."
                className={`${inputClass} ${stockInsuf ? "border-red-400 bg-red-50" : ""}`}
                min={1} step={1}
              />
            </div>

            {/* Precio — 2 cols */}
            <div className="lg:col-span-2">
              <label className={labelClass}>Precio (Gs.)</label>
              <MontoInput
                value={lineaPrecio}
                onChange={(n) => { setErrorLinea(null); setLineaPrecio(String(n)); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAgregarLinea(); }}}
                placeholder="Precio"
                className={inputClass}
                decimals={false}
              />
            </div>

            {/* IVA — 2 cols */}
            <div className="lg:col-span-2">
              <label className={labelClass}>IVA</label>
              <SegmentedControl<TipoIvaVenta>
                value={lineaIva}
                options={[
                  { value: "EXENTA", label: "Ex"  },
                  { value: "5%",     label: "5%"  },
                  { value: "10%",    label: "10%" },
                ]}
                onChange={setLineaIva}
              />
            </div>

            {/* Botón — 2 cols */}
            <div className="flex flex-col lg:col-span-2">
              <label className="invisible text-xs mb-1.5">.</label>
              <button
                type="button"
                onClick={handleAgregarLinea}
                disabled={!lineaValida}
                className="flex items-center justify-center gap-1.5 w-full bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                Agregar producto
              </button>
            </div>

          </div>

          {/* Tipo de precio (minorista / mayorista / al costo) — visible al elegir producto */}
          {prodSel && (
            <div className="mt-4">
              <label className={labelClass}>Tipo de precio</label>
              <div className="flex max-w-md border border-slate-200 rounded-lg overflow-hidden">
                {TIPOS_PRECIO_UI.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleLineaTipoPrecio(t)}
                    className={`flex-1 py-2 px-1 text-center transition-colors ${
                      lineaTipoPrecio === t ? "bg-[#0EA5E9] text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="block text-sm font-medium">{tipoPrecioLabel[t]}</span>
                    <span className={`block text-[11px] tabular-nums ${lineaTipoPrecio === t ? "text-white/90" : "text-slate-400"}`}>
                      {formatGs(precioPorTipo(prodSel, t))}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-gray-400">
                El precio unitario se ajusta al tipo elegido; podés editarlo manualmente si hace falta.
              </p>
            </div>
          )}

          {/* Preview totales de la línea */}
          {lineaSubtotal > 0 && (
            <div className="mt-3 flex gap-4 text-xs text-gray-500">
              <span>Subtotal: <strong className="text-gray-800">{formatGs(lineaSubtotal)}</strong></span>
              <span>IVA: <strong className="text-gray-800">
                {lineaIva === "EXENTA" ? "—" : formatGs(lineaMontoIva)}
              </strong></span>
              <span>Total línea: <strong className="text-gray-900">{formatGs(lineaTotalLinea)}</strong></span>
            </div>
          )}

          {/* Error agregar */}
          {errorLinea && (
            <div className="mt-3 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
              <span>⚠</span><span className="font-medium">{errorLinea}</span>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 3: Carrito + totales + confirmar ─────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6">
          <SectionTitle>Productos en esta venta</SectionTitle>

          {items.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
              Todavía no agregaste productos a esta venta.
            </div>
          ) : (
            <>
              {/* min-w fuerza scroll horizontal en mobile (9 columnas).
                  Columnas secundarias (SKU, Subtotal, IVA Gs) se ocultan
                  progresivamente: en mobile solo Producto/Cant/Precio/Total/eliminar. */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] sm:min-w-0 text-sm text-left">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 text-sm font-semibold">
                      <th className="py-2.5 pr-3 font-medium">Producto</th>
                      <th className="hidden py-2.5 pr-3 font-medium lg:table-cell">SKU</th>
                      <th className="py-2.5 pr-3 font-medium text-right">Cant.</th>
                      <th className="py-2.5 pr-3 font-medium text-right">Precio unit.</th>
                      <th className="hidden py-2.5 pr-3 text-center font-medium lg:table-cell">IVA</th>
                      <th className="py-2.5 pr-3 font-medium text-right hidden lg:table-cell">Subtotal</th>
                      <th className="py-2.5 pr-3 font-medium text-right hidden lg:table-cell">IVA Gs.</th>
                      <th className="py-2.5 pr-3 font-medium text-right">Total</th>
                      <th className="py-2.5 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={idx} className="border-b border-slate-200 last:border-0 hover:bg-slate-50 transition-colors">
                        <td className="py-3 pr-3 font-medium text-gray-800">
                          <span>{item.producto_nombre}</span>
                          <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold align-middle ${
                            item.tipo_precio === "mayorista" ? "bg-indigo-100 text-indigo-700"
                            : item.tipo_precio === "distribuidor" ? "bg-emerald-100 text-emerald-700"
                            : item.tipo_precio === "costo" ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                          }`}>
                            {tipoPrecioLabel[item.tipo_precio ?? "minorista"]}
                          </span>
                        </td>
                        <td className="hidden py-3 pr-3 font-mono text-xs text-gray-500 lg:table-cell">
                          {item.sku}
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums">
                          {item.cantidad}
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums text-gray-600 text-xs">
                          {formatGs(item.precio_venta)}
                        </td>
                        <td className="hidden py-3 pr-3 text-center lg:table-cell">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                            {ivaLabel[item.tipo_iva]}
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums text-gray-600 text-xs hidden lg:table-cell">
                          {formatGs(item.subtotal)}
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums text-gray-500 text-xs hidden lg:table-cell">
                          {item.monto_iva > 0 ? formatGs(item.monto_iva) : "—"}
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums font-semibold text-gray-800">
                          {formatGs(item.total_linea)}
                        </td>
                        <td className="py-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleEliminarLinea(idx)}
                            className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] text-red-400 hover:text-red-700 transition-colors rounded hover:bg-red-50"
                            title="Eliminar producto"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                              <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totales + Cobro (vuelto) */}
              <div className="mt-5 flex justify-end">
                <div className="w-full space-y-3 lg:w-80">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Subtotal</span>
                      <span className="tabular-nums font-medium">{formatGs(totalSubtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>IVA</span>
                      <span className="tabular-nums font-medium">
                        {totalIva > 0 ? formatGs(totalIva) : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-200">
                      <span>TOTAL</span>
                      <span className="tabular-nums">{formatGs(totalGeneral)}</span>
                    </div>
                  </div>

                  {tipoVenta === "CONTADO" && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        Cobro
                      </p>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Método de pago</label>
                        <div className="grid grid-cols-3 gap-1">
                          {(["efectivo", "tarjeta", "transferencia"] as MetodoPago[]).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setMetodoPago(m)}
                              className={`text-xs py-1.5 rounded-md border transition-colors ${
                                metodoPago === m
                                  ? "border-[#0EA5E9] bg-[#0EA5E9]/10 text-[#0EA5E9] font-medium"
                                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              {m === "efectivo" ? "Efectivo" : m === "tarjeta" ? "Tarjeta" : "Transfer."}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Monto recibido (Gs.)
                        </label>
                        <MontoInput
                          value={montoRecibido}
                          onChange={(n) => setMontoRecibido(String(n))}
                          placeholder="Ej: 100.000"
                          className={inputClass}
                          decimals={false}
                        />
                      </div>
                      {montoRecibidoNum > 0 && (
                        <div className="flex justify-between text-sm pt-2 border-t border-slate-200">
                          {vuelto >= 0 ? (
                            <>
                              <span className="text-gray-600">Vuelto</span>
                              <span className="font-bold text-emerald-600 tabular-nums">
                                {formatGs(vuelto)}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-gray-600">Falta</span>
                              <span className="font-bold text-red-600 tabular-nums">
                                {formatGs(Math.abs(vuelto))}
                              </span>
                            </>
                          )}
                        </div>
                      )}
                      <p className="text-[11px] text-gray-400 leading-snug">
                        El monto recibido / vuelto es solo informativo — no se guarda.
                      </p>

                      {/* Detalle de cobro (conciliación bancaria) — opcional */}
                      <div className="mt-2 border-t border-slate-200 pt-2 space-y-2">
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                          Detalle de cobro <span className="font-normal normal-case tracking-normal text-gray-400">(conciliación · opcional)</span>
                        </p>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Entidad / caja</label>
                          <select
                            value={pagoEntidadId}
                            onChange={(e) => setPagoEntidadId(e.target.value)}
                            className={inputClass}
                          >
                            <option value="">— Sin especificar —</option>
                            {entidades.map((en) => (
                              <option key={en.id} value={en.id}>{en.nombre}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Referencia / comprobante</label>
                          <input
                            type="text"
                            value={pagoReferencia}
                            onChange={(e) => setPagoReferencia(e.target.value)}
                            placeholder="Opcional — N° de comprobante / transacción"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Observación</label>
                          <input
                            type="text"
                            value={pagoObservacion}
                            onChange={(e) => setPagoObservacion(e.target.value)}
                            placeholder="Opcional"
                            className={inputClass}
                          />
                        </div>
                        <p className="text-[11px] text-gray-400 leading-snug">
                          Se registra para la conciliación; el cobro es por el total de la venta.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Error confirmar */}
          {errorVenta && (
            <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
              <span className="text-base leading-none mt-0.5">⚠</span>
              <span className="font-medium">{errorVenta}</span>
            </div>
          )}

          {/* Acciones — stack vertical full-width en mobile (mas facil de tappear),
              fila en sm+. Confirmar en orden visual primero (primary). */}
          <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => router.push("/ventas")}
              className="border border-slate-200 px-6 py-3 rounded-lg text-sm hover:bg-slate-50 transition-colors min-h-[48px] w-full sm:w-auto"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!ventaValida}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 min-h-[48px] w-full sm:w-auto"
            >
              Confirmar venta
            </button>
          </div>

        </div>

      </form>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAgregar={handleAgregarDesdePicker}
        excludeIds={items.map((i) => i.producto_id)}
        moneda={moneda}
        tipoCambio={tipoCambioNum}
        ivaDefault={lineaIva}
      />
    </div>
  );
}
