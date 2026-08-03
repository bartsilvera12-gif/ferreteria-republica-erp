"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export type EdgeScrollAreaProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** Distancia desde el borde (en px) dentro de la cual se activa el auto-scroll. */
  edgeZone?: number;
  /** Velocidad máxima de scroll por frame (px). */
  maxSpeed?: number;
  /** Si true, dibuja gradientes laterales como hint visual. */
  showHints?: boolean;
  /** Si true, permite arrastrar con el cursor (click + mover) para hacer scroll horizontal. */
  drag?: boolean;
};

/**
 * Contenedor que hace auto-scroll horizontal cuando el mouse se acerca a los
 * bordes laterales. Útil para tablas con muchas columnas, donde la barra de
 * scroll nativa es engorrosa y el usuario querría arrastrar sin click+drag.
 *
 * Uso típico:
 *   <EdgeScrollArea>
 *     <table className="min-w-[900px]">...</table>
 *   </EdgeScrollArea>
 */
export default function EdgeScrollArea({
  children,
  className = "",
  edgeZone = 70,
  maxSpeed = 22,
  showHints = false,
  drag = false,
  ...rest
}: EdgeScrollAreaProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const speedRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  // Arrastre con el cursor (click + mover) para scroll horizontal.
  const dragRef = useRef<{ down: boolean; startX: number; startScroll: number; moved: boolean }>({ down: false, startX: 0, startScroll: 0, moved: false });

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    speedRef.current = 0;
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const fromLeft = x;
      const fromRight = rect.width - x;
      let speed = 0;
      if (fromLeft < edgeZone) {
        const intensity = (edgeZone - fromLeft) / edgeZone;
        speed = -Math.ceil(maxSpeed * intensity);
      } else if (fromRight < edgeZone) {
        const intensity = (edgeZone - fromRight) / edgeZone;
        speed = Math.ceil(maxSpeed * intensity);
      }
      speedRef.current = speed;
      if (speed !== 0 && rafRef.current === null) {
        const step = () => {
          const node = containerRef.current;
          if (!node || speedRef.current === 0) {
            rafRef.current = null;
            return;
          }
          const maxScroll = node.scrollWidth - node.clientWidth;
          const next = Math.min(
            Math.max(node.scrollLeft + speedRef.current, 0),
            maxScroll
          );
          if (next === node.scrollLeft) {
            speedRef.current = 0;
            rafRef.current = null;
            return;
          }
          node.scrollLeft = next;
          rafRef.current = requestAnimationFrame(step);
        };
        rafRef.current = requestAnimationFrame(step);
      }
    },
    [edgeZone, maxSpeed]
  );

  // ── Arrastre con el cursor ────────────────────────────────────────────────
  const onDragDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!drag) return;
    const el = containerRef.current;
    if (!el) return;
    dragRef.current = { down: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
  }, [drag]);

  const onDragMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    handleMouseMove(e);
    if (!drag) return;
    const st = dragRef.current;
    const el = containerRef.current;
    if (!st.down || !el) return;
    const dx = e.clientX - st.startX;
    if (Math.abs(dx) > 4) st.moved = true;
    if (st.moved) {
      el.scrollLeft = st.startScroll - dx;
      e.preventDefault();
    }
  }, [drag, handleMouseMove]);

  const endDrag = useCallback(() => { dragRef.current.down = false; }, []);

  // Si hubo arrastre, se cancela el click siguiente (para no abrir la fila).
  const onClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (drag && dragRef.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current.moved = false;
    }
  }, [drag]);

  const handleMouseLeave = useCallback(() => {
    stopLoop();
    dragRef.current.down = false;
  }, [stopLoop]);

  useEffect(() => () => stopLoop(), [stopLoop]);

  return (
    <div className={`relative ${className}`} {...rest}>
      <div
        ref={containerRef}
        className={`overflow-x-auto overscroll-x-contain pb-2 ${drag ? "cursor-grab active:cursor-grabbing select-none" : ""}`}
        onMouseMove={onDragMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={onDragDown}
        onMouseUp={endDrag}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
      {showHints ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white/80 to-transparent"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/80 to-transparent"
          />
        </>
      ) : null}
    </div>
  );
}
