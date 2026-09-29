"use client";

/**
 * Modal liviano para CONSULTAR la ficha (producto o cliente) SIN conexión.
 *
 * Muestra los datos que ya están cargados en la lista (cacheados), sin navegar a
 * la página de detalle (que es pesada y no renderiza bien offline). Es solo
 * lectura: cuando vuelve internet, el usuario abre la ficha completa normal.
 */
export interface CampoDetalle {
  label: string;
  value: string | number | null | undefined;
}

export default function OfflineDetalleModal({
  titulo,
  subtitulo,
  campos,
  onClose,
}: {
  titulo: string;
  subtitulo?: string | null;
  campos: CampoDetalle[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">{titulo}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        {subtitulo ? <p className="mb-3 text-sm text-gray-500">{subtitulo}</p> : null}
        <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Sin conexión — vista de consulta. La ficha completa se abre con internet.
        </div>
        <dl className="divide-y divide-gray-100">
          {campos
            .filter((c) => c.value !== null && c.value !== undefined && String(c.value).trim() !== "")
            .map((c) => (
              <div key={c.label} className="flex justify-between gap-4 py-2">
                <dt className="text-sm text-gray-500">{c.label}</dt>
                <dd className="text-right text-sm font-medium text-gray-900">{String(c.value)}</dd>
              </div>
            ))}
        </dl>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-[#4FAEB2] py-2.5 text-sm font-semibold text-white"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
