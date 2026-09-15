import React, { useEffect, useRef } from 'react';
import { FilePreviewData, FilePreviewRequest } from './shared';
import { Icon } from './Icon';

export function FilePreview({ request, data, onClose, onOpen }: {
  request: FilePreviewRequest; data?: FilePreviewData; onClose(): void; onOpen(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const selectedLine = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => { selectedLine.current?.scrollIntoView({ block: 'center' }); }, [data]);
  return <dialog ref={dialog} className="file-preview" aria-labelledby="file-preview-title" onCancel={e => { e.preventDefault(); onClose(); }}
    onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}
    onKeyDown={e => e.stopPropagation()}>
    <header className="file-preview-header">
      <div className="file-preview-heading"><strong id="file-preview-title">File preview</strong><span title={data?.path ?? request.path}>{data?.path ?? request.path}{data?.line ? `:${data.line}${data.column ? ':' + data.column : ''}` : ''}</span></div>
      <button onClick={onOpen} title="Keep Ronin active and open the file in its editor group">Open in background tab</button>
      <button autoFocus className="icon-button" aria-label="Close preview" title="Close preview (Escape)" onClick={onClose}><Icon name="close" /></button>
    </header>
    {!data && <p role="status" className="file-preview-message">Loading file…</p>}
    {data?.error && <p role="alert" className="file-preview-message">{data.error}</p>}
    {data?.note && <p className="file-preview-message">{data.note}</p>}
    {data?.content !== undefined && <div className="file-preview-content" tabIndex={0} aria-label="File contents">
      {data.content.split(/\r?\n/).map((text, index) => {
        const number = (data.startLine ?? 1) + index;
        return <div key={number} ref={number === data.line ? selectedLine : undefined} className={`file-preview-line${number === data.line ? ' selected' : ''}`}>
          <span className="file-preview-number" aria-hidden="true">{number}</span><span>{text || '\u00a0'}</span>
        </div>;
      })}
    </div>}
  </dialog>;
}
