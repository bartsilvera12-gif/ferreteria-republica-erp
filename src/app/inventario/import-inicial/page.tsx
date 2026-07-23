import ImportInicialWizard from "@/components/inventario/ImportInicialWizard";

export const metadata = { title: "Importación inicial de productos" };

export default function ImportInicialPage() {
  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
      <header className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
          Zentra · Inventario
        </p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900">
          Importación inicial de productos
        </h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Combina los tres reportes en un único catálogo, sin duplicados.
        </p>
      </header>
      <ImportInicialWizard />
    </div>
  );
}
