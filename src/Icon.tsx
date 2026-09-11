import React from 'react';
const paths = {
  sidebar: <><rect x="2" y="3" width="16" height="14" rx="2"/><path d="M7 3v14"/></>,
  terminal: <><rect x="2" y="3" width="16" height="14" rx="2"/><path d="m5 7 3 3-3 3m6 0h4"/></>,
  agent: <><rect x="3" y="6" width="14" height="11" rx="3"/><path d="M10 6V3m-2 0h4M6 10h1m6 0h1m-7 4h6"/></>,
  fit: <><path d="M7 2H2v5m11-5h5v5M2 13v5h5m11-5v5h-5"/><rect x="6" y="6" width="8" height="8" rx="1"/></>,
  arrange: <><rect x="2" y="3" width="7" height="6" rx="1"/><rect x="12" y="3" width="6" height="6" rx="1"/><rect x="2" y="12" width="7" height="5" rx="1"/><rect x="12" y="12" width="6" height="5" rx="1"/></>,
  reset: <><path d="M4 6a7 7 0 1 1-1 7M4 2v5h5"/></>,
  pin: <><path d="m7 2 7 3-2 4 2 4-5-1-3 3-1-5-3-2 5-2Zm2 10-5 6"/></>,
  close: <path d="m5 5 10 10M15 5 5 15"/>,
  trash: <><path d="M3 5h14M7 5V2h6v3M5 5l1 13h8l1-13M8 8v7m4-7v7"/></>,
  edit: <><path d="m4 12-1 5 5-1L17 7l-4-4-9 9Zm7-7 4 4"/></>,
  maximize: <rect x="3" y="3" width="14" height="14" rx="1"/>,
  plus: <path d="M10 4v12M4 10h12"/>,
  play: <path d="m6 3 10 7-10 7Z"/>,
  search: <><circle cx="8" cy="8" r="5"/><path d="m12 12 5 5"/></>,
  tasks: <><path d="m2 5 2 2 3-4m-5 9 2 2 3-4M10 5h8m-8 7h8"/></>,
  note: <><path d="M4 2h8l4 4v12H4ZM12 2v5h4M7 10h6m-6 3h6"/></>,
};
export function Icon({ name }: { name: keyof typeof paths }) { return <svg className="icon" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
