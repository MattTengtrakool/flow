const flowIconUrl = new URL('../../../brand/flow-icon-128.png', import.meta.url)
  .href;

const loadingSteps = [
  'Loading local settings',
  'Checking privacy state',
  'Preparing your timeline',
];

export function LoadingScreen() {
  return (
    <main className="loading-shell" aria-busy="true" aria-label="Loading Flow">
      <section className="loading-panel">
        <div className="loading-brand">
          <span className="loading-brand__halo" aria-hidden="true" />
          <img src={flowIconUrl} alt="" className="loading-brand__mark" />
        </div>

        <div className="loading-copy">
          <p className="eyebrow">Starting Flow</p>
          <h1>Preparing your private worklog</h1>
          <p>
            Loading local settings, permissions, and timeline state before
            capture starts.
          </p>
        </div>

        <div className="loading-progress" aria-hidden="true">
          <span />
        </div>

        <div className="loading-steps">
          {loadingSteps.map(step => (
            <div key={step} className="loading-step">
              <span className="loading-step__dot" />
              <span>{step}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
