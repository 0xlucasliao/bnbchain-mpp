import { useState } from "react";
import { ENTITY_COPY } from "./liveDemoCopy";
import { ExplainerModal } from "./ExplainerModal";

export type SeqRole = "agent" | "server";

export type SeqMessage = {
  id: string;
  from: SeqRole;
  to: SeqRole;
  label: string;
  /** Explicit SDK / API surface for this step (shown under the label). */
  sdk: string;
  explainer: string;
  direction: "request" | "response" | "internal";
};

type ModalState = { title: string; body: string };

function InfoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="explainer-info-btn" aria-label={label} onClick={onClick}>
      ⓘ
    </button>
  );
}

/** SVG message arrow between Agent (left) and Server (right). */
function SeqArrowSvg({ m }: { m: SeqMessage }) {
  const agentX = 20;
  const serverX = 248;
  const y = 26;
  const midY = 26;
  const uid = m.id.replace(/[^a-zA-Z0-9_-]/g, "");

  if (m.direction === "internal") {
    return (
      <svg
        viewBox="0 0 268 48"
        className="seq-arrow-svg seq-arrow-svg--internal"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <path
          d={`M ${agentX} 40 L 64 40 L 64 12 L ${agentX + 6} 12`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polygon points={`${agentX},18 ${agentX + 7},12 ${agentX},8`} fill="currentColor" />
      </svg>
    );
  }

  if (m.direction === "request") {
    return (
      <svg
        viewBox="0 0 268 48"
        className="seq-arrow-svg seq-arrow-svg--request"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <marker
            id={`arr-req-${uid}`}
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <polygon points="0 0, 7 3.5, 0 7" fill="currentColor" />
          </marker>
        </defs>
        <line
          x1={agentX}
          y1={midY}
          x2={serverX - 7}
          y2={midY}
          stroke="currentColor"
          strokeWidth="1.75"
          markerEnd={`url(#arr-req-${uid})`}
        />
      </svg>
    );
  }

  /* Same head shape as request: orient="auto" aligns +x with path tangent at end,
   * so this points toward Agent for Server→Agent (tangent points left). */
  return (
    <svg
      viewBox="0 0 268 48"
      className="seq-arrow-svg seq-arrow-svg--response"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <defs>
        <marker
          id={`arr-res-${uid}`}
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polygon points="0 0, 7 3.5, 0 7" fill="currentColor" />
        </marker>
      </defs>
      <line
        x1={serverX}
        y1={y}
        x2={agentX + 7}
        y2={y}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeDasharray="6 5"
        markerEnd={`url(#arr-res-${uid})`}
      />
    </svg>
  );
}

export function SequenceDiagram({ messages }: { messages: SeqMessage[] }) {
  const [modal, setModal] = useState<ModalState | null>(null);
  const a = ENTITY_COPY.agent;
  const s = ENTITY_COPY.server;

  const open = (state: ModalState) => setModal(state);
  const close = () => setModal(null);

  return (
    <>
      <ExplainerModal
        open={modal !== null}
        title={modal?.title ?? ""}
        body={modal?.body ?? ""}
        onClose={close}
      />

      <div className="sequence-diagram">
        <div className="seq-canvas" aria-label="Agent and Server sequence">
          <div className="seq-canvas__header seq-canvas__header--agent">
            <span className="seq-canvas__entity-name">{a.title}</span>
            <InfoButton label={`About ${a.title}`} onClick={() => open({ title: a.title, body: a.body })} />
          </div>
          <div className="seq-canvas__header seq-canvas__header--mid" aria-hidden />
          <div className="seq-canvas__header seq-canvas__header--server">
            <span className="seq-canvas__entity-name">{s.title}</span>
            <InfoButton label={`About ${s.title}`} onClick={() => open({ title: s.title, body: s.body })} />
          </div>

          <div className="seq-canvas__lane seq-canvas__lane--agent">
            <div className="seq-canvas__lifeline seq-canvas__lifeline--agent" />
          </div>

          <div className="seq-canvas__lane seq-canvas__lane--mid">
            {messages.length === 0 ? (
              <p className="seq-canvas__empty muted small">Run the pipeline to draw messages.</p>
            ) : (
              <ul className="seq-canvas__rows">
                {messages.map((m) => (
                  <li key={m.id} className={`seq-canvas__row seq-canvas__row--${m.direction}`}>
                    <div className="seq-canvas__svg-cell">
                      <SeqArrowSvg m={m} />
                    </div>
                    <div className="seq-canvas__caption">
                      <div className="seq-canvas__caption-line">
                        <span className="seq-canvas__caption-text">{m.label}</span>
                        <InfoButton
                          label={`Details: ${m.label}`}
                          onClick={() =>
                            open({
                              title: m.label,
                              body: `${m.explainer}\n\n— SDK —\n${m.sdk}`,
                            })
                          }
                        />
                      </div>
                      <pre className="seq-canvas__sdk">{m.sdk}</pre>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="seq-canvas__lane seq-canvas__lane--server">
            <div className="seq-canvas__lifeline seq-canvas__lifeline--server" />
          </div>
        </div>
      </div>
    </>
  );
}
