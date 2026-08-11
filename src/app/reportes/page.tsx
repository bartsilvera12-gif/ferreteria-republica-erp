"use client";

import PageHeader from "@/components/ui/PageHeader";
import { ReportCard } from "@/components/reportes/ReportCard";
import { Wallet, Truck, Package, ShoppingCart, ArrowLeftRight, Lock, BarChart3, CalendarClock, CreditCard, FileText, PackageMinus, Boxes } from "lucide-react";

/** Hub de reportería operativa (Fase 1: Estado de cuenta + Proveedores). */
export default function ReportesPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Análisis"
        title="Reportes"
        description="Panel de análisis y reportería operativa"
      />

      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
        <li>
          <ReportCard
            title="Estado de cuenta"
            subtitle="Saldos, movimientos y situación financiera"
            icon={Wallet}
            description="Resumen de ventas, compras, gastos y resultado del período, con sus movimientos."
            href="/reportes/estado-cuenta"
          />
        </li>
        <li>
          <ReportCard
            title="Ventas"
            subtitle="Facturación y operaciones"
            icon={ShoppingCart}
            description="Ventas del mes, desglose por tipo de precio (minorista/mayorista/al costo) y por producto."
            href="/reportes/ventas"
          />
        </li>
        <li>
          <ReportCard
            title="Reporte de ventas"
            subtitle="Ventas con filtros y export PDF"
            icon={ShoppingCart}
            description="Ventas por rango de fechas con filtros por cliente, cajero, tipo (contado/crédito), facturación y cobro. Detalle o resumido, exportable a PDF."
            href="/reportes/ventas-detalle"
          />
        </li>
        <li>
          <ReportCard
            title="Facturas emitidas"
            subtitle="Comprobantes fiscales del autoimpresor"
            icon={FileText}
            description="Todas las facturas emitidas por rango de fechas y cliente, con su desglose de IVA, totales y exportación a PDF."
            href="/reportes/facturas"
          />
        </li>
        <li>
          <ReportCard
            title="Créditos por cliente"
            subtitle="Ventas a crédito y cobranzas"
            icon={CreditCard}
            description="Clientes con ventas a crédito: saldo pendiente, vencido y próximo vencimiento. Extracto por cliente imprimible para seguimiento."
            href="/reportes/creditos"
          />
        </li>
        <li>
          <ReportCard
            title="Compras"
            subtitle="Adquisiciones y costos"
            icon={Package}
            description="Compras del mes (agrupadas por N° de control), por proveedor y por producto."
            href="/reportes/compras"
          />
        </li>
        <li>
          <ReportCard
            title="Proveedores"
            subtitle="Abastecimiento y relación comercial"
            icon={Truck}
            description="Resumen de proveedores, compras por proveedor y actividad del mes."
            href="/reportes/proveedores"
          />
        </li>
        <li>
          <ReportCard
            title="Conciliación bancaria"
            subtitle="Cobros por método y entidad"
            icon={ArrowLeftRight}
            description="Detalle de cobro por venta (efectivo/transferencia/tarjeta), por método y por entidad."
            href="/reportes/conciliacion"
          />
        </li>
        <li>
          <ReportCard
            title="Cierres de caja"
            subtitle="Arqueo de turnos"
            icon={Lock}
            description="Turnos de caja por rango de fechas: apertura, cierre, efectivo esperado vs. contado y diferencias."
            href="/reportes/cajas"
          />
        </li>
        <li>
          <ReportCard
            title="Rotación de productos"
            subtitle="Clasificación ABC por ventas"
            icon={BarChart3}
            description="Productos muy vendidos (A), medios (B) y con poca o ninguna venta (C) en el último 1, 2 o 3 meses."
            href="/reportes/rotacion-abc"
          />
        </li>
        <li>
          <ReportCard
            title="Proyección de inventario"
            subtitle="Cobertura de stock en días"
            icon={CalendarClock}
            description="Días estimados que dura el stock según el ritmo de venta (30/60/90 días), fecha de quiebre y estado (crítico/bajo/normal/sobrestock)."
            href="/reportes/proyeccion-inventario"
          />
        </li>
        <li>
          <ReportCard
            title="Stock mínimo"
            subtitle="Productos por reponer"
            icon={PackageMinus}
            description="Productos cuyo stock actual quedó por debajo del mínimo definido. Ordenados por mayor faltante."
            href="/reportes/stock-minimo"
          />
        </li>
        <li>
          <ReportCard
            title="Productos vendidos"
            subtitle="Cuánto se vendió de cada uno"
            icon={Boxes}
            description="Unidades y total vendido por producto (resumido) o cada venta con factura, cajero y vendedor (detallado). Filtrable por categoría y fechas."
            href="/reportes/productos-vendidos"
          />
        </li>
      </ul>
    </div>
  );
}
