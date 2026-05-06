import { useEffect } from "react";

type Props = {
  open: boolean;
  title: string;
  body: string;
  onClose: () => void;
};

export function ExplainerModal({ open, title, body, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="explainer-modal-root">
      <button type="button" className="explainer-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div
        className="explainer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explainer-modal-title"
      >
        <header className="explainer-modal__header">
          <h2 id="explainer-modal-title" className="explainer-modal__title">
            {title}
          </h2>
          <button type="button" className="explainer-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="explainer-modal__body">{body}</div>
        <footer className="explainer-modal__footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
