import type React from 'react';

export function Screen(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="screen">
      <h1>{props.title}</h1>
      {props.children}
    </section>
  );
}

export function SmallList(props: { label: string; values: string[] }) {
  if (props.values.length === 0) return null;
  return (
    <div className="small-list">
      <strong>{props.label}</strong>
      <span>{props.values.join(', ')}</span>
    </div>
  );
}
