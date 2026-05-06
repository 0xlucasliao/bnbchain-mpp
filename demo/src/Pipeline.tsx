export type PipelineStepStatus = "pending" | "active" | "ok" | "error";

export type PipelineStep = {
  key: string;
  /** Plain-language “why this step exists” for non-developers. */
  intent: string;
  /** Which @bnb/mpp / MPP entry points this stage exercises (may include plain `fetch` where no SDK wraps the call). */
  sdk: string;
  title: string;
  detail: string;
  status: PipelineStepStatus;
  output?: string;
};

export function Pipeline({
  steps,
  revealedStepCount,
}: {
  steps: PipelineStep[];
  /** How many steps to show (left-to-right). Idle demo uses `steps.length`; during a run this grows 1…n. */
  revealedStepCount: number;
}) {
  const n = Math.max(0, Math.min(revealedStepCount, steps.length));
  const visible = steps.slice(0, n);

  if (visible.length === 0) {
    return (
      <div className="pipeline-scroll">
        <div className="pipeline pipeline--empty muted small">Run the pipeline to reveal each step.</div>
      </div>
    );
  }

  return (
    <div className="pipeline-scroll">
      <div className="pipeline">
        {visible.map((s, i) => (
          <div className="pipeline-segment pipeline-segment--enter" key={s.key}>
            <article className={`pipeline-node pipeline-node--${s.status}`}>
              <p className="pipeline-intent">
                <span className="pipeline-intent-label">Intent</span>
                {s.intent}
              </p>
              <p className="pipeline-sdk">
                <span className="pipeline-sdk-label">MPP SDK</span>
                {s.sdk}
              </p>
              <header className="pipeline-node-head">
                <span className="pipeline-status-dot" data-status={s.status} aria-hidden />
                <h3 className="pipeline-node-title">{s.title}</h3>
              </header>
              <p className="pipeline-node-detail">{s.detail}</p>
              {s.output !== undefined && s.output !== "" && (
                <pre className="pipeline-output">{s.output}</pre>
              )}
            </article>
            {i < visible.length - 1 ? (
              <div className="pipeline-arrow" aria-hidden>
                <span className="pipeline-arrow-line" />
                <span className="pipeline-arrow-head">▶</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
