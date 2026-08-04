export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-lockup" aria-label="YOVA">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" role="img">
          <path d="M13 14.5 24 26l11-11.5" />
          <path d="M24 26v10" />
          <path className="spark" d="M34 6v6M31 9h6" />
        </svg>
      </span>
      {!compact && <span className="brand-word">YOVA</span>}
    </div>
  );
}
