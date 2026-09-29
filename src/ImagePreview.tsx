import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function ImagePreview({ image, path, onError }: { image: string; path: string; onError(): void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const anchor = useRef<{ x: number; y: number; imageX: number; imageY: number } | null>(null);
  const fit = natural.width ? Math.min(1, Math.max(1, size.width - 24) / natural.width, Math.max(1, size.height - 24) / natural.height) : 1;
  const minimum = Math.min(0.05, fit);
  const scale = zoom ?? fit;
  const width = natural.width * scale;
  const height = natural.height * scale;

  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      const id = drag.current?.id;
      drag.current = null;
      if (id !== undefined && element.hasPointerCapture(id)) element.releasePointerCapture(id);
    };
  }, []);

  const changeZoom = (value: number, clientX?: number, clientY?: number) => {
    if (!natural.width) return;
    const next = Math.min(8, Math.max(minimum, value));
    if (next === scale) return;
    const element = viewport.current!;
    const bounds = element.getBoundingClientRect();
    const imageBounds = picture.current!.getBoundingClientRect();
    const x = clientX ?? bounds.left + element.clientWidth / 2;
    const y = clientY ?? bounds.top + element.clientHeight / 2;
    anchor.current = { x: x - bounds.left, y: y - bounds.top, imageX: (x - imageBounds.left) / scale, imageY: (y - imageBounds.top) / scale };
    setZoom(next);
  };
  useLayoutEffect(() => {
    const point = anchor.current;
    if (!point) return;
    const element = viewport.current!;
    const bounds = element.getBoundingClientRect();
    const imageBounds = picture.current!.getBoundingClientRect();
    element.scrollLeft += imageBounds.left + point.imageX * scale - bounds.left - point.x;
    element.scrollTop += imageBounds.top + point.imageY * scale - bounds.top - point.y;
    anchor.current = null;
  }, [scale]);

  useEffect(() => {
    const element = viewport.current!;
    const wheel = (event: WheelEvent) => {
      // React's wheel listener is passive; a local listener also prevents the
      // browser from zooming the entire webview during a trackpad pinch.
      event.preventDefault();
      event.stopPropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      if (event.shiftKey) {
        element.scrollLeft += (event.deltaX || event.deltaY) * unit;
        return;
      }
      const delta = Math.max(-100, Math.min(100, event.deltaY * unit));
      changeZoom(scale * Math.exp(-delta * 0.003), event.clientX, event.clientY);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [scale, natural, size]);

  const endPan = () => {
    const id = drag.current?.id;
    drag.current = null;
    if (id !== undefined && viewport.current?.hasPointerCapture(id)) viewport.current.releasePointerCapture(id);
    setPanning(false);
  };
  useEffect(() => {
    window.addEventListener('blur', endPan);
    return () => window.removeEventListener('blur', endPan);
  }, []);

  return <>
    <div className="file-preview-image-toolbar" role="group" aria-label="Image zoom controls">
      <button aria-label="Zoom out" title="Zoom out" disabled={!natural.width || scale <= minimum} onClick={() => changeZoom(scale / 1.25)}>−</button>
      <span className="file-preview-zoom" aria-label="Zoom level">{Math.round(scale * 100)}%</span>
      <button aria-label="Zoom in" title="Zoom in" disabled={!natural.width || scale >= 8} onClick={() => changeZoom(scale * 1.25)}>+</button>
      <button aria-pressed={zoom === null} onClick={() => { anchor.current = null; setZoom(null); viewport.current!.scrollTo(0, 0); }}>Fit image</button>
      <button aria-pressed={zoom === 1} onClick={() => changeZoom(1)}>Actual size</button>
      <span id="image-preview-help">Scroll to zoom · Drag to pan · Shift-scroll sideways</span>
    </div>
    <div ref={viewport} className={`file-preview-image${panning ? ' panning' : ''}`} tabIndex={0} role="region" aria-label="Image preview" aria-describedby="image-preview-help"
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        const element = event.currentTarget;
        const bounds = element.getBoundingClientRect();
        // Leave the native scrollbars free to handle their own pointer input.
        if (event.clientX >= bounds.left + element.clientWidth || event.clientY >= bounds.top + element.clientHeight) return;
        if (element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight) return;
        event.preventDefault();
        element.focus({ preventScroll: true });
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
        element.setPointerCapture(event.pointerId);
        setPanning(true);
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        if (!(event.buttons & 1)) { endPan(); return; }
        event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
        event.currentTarget.scrollTop = start.top + start.y - event.clientY;
      }}
      onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}>
      <div className="file-preview-image-stage" style={{ width: Math.max(size.width, width), height: Math.max(size.height, height) }}>
        <img ref={picture} src={image} alt={path} draggable={false} onError={onError}
          onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          style={{ width, height, left: Math.max(0, (size.width - width) / 2), top: Math.max(0, (size.height - height) / 2) }} />
      </div>
    </div>
  </>;
}
