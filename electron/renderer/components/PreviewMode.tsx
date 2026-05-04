export function PreviewMode() {
  return (
    <main className="preview-shell">
      <section className="preview-panel">
        <div className="preview-mark">Flow</div>
        <p className="eyebrow">Preview mode</p>
        <h1>Open Flow in Electron to capture your work.</h1>
        <p>
          This browser preview is only for checking layout. Native capture,
          permissions, local storage, managed AI, and timeline actions are
          available in the Electron app.
        </p>
        <div className="code-card">
          NODENV_VERSION=24.14.1 pnpm electron:dev
        </div>
      </section>
    </main>
  );
}
