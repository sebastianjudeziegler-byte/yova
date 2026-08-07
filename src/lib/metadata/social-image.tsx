export function YovaSocialImage() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        padding: "70px 76px",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        overflow: "hidden",
        color: "#FFFFFF",
        background: "#0B1020",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          width: 520,
          height: 520,
          position: "absolute",
          top: -230,
          right: -110,
          display: "flex",
          borderRadius: 999,
          background: "radial-gradient(circle, rgba(52,107,255,0.62) 0%, rgba(122,92,255,0.22) 48%, rgba(11,16,32,0) 72%)",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            width: 66,
            height: 66,
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 18,
            background: "#FFFFFF",
          }}
        >
          <svg width="48" height="48" viewBox="0 0 48 48">
            <path d="M13 14.5 24 26l11-11.5M24 26v10" fill="none" stroke="#0B1020" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M34 6v6M31 9h6" fill="none" stroke="#346BFF" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ display: "flex", fontSize: 31, fontWeight: 800, letterSpacing: 7 }}>YOVA</div>
      </div>

      <div style={{ maxWidth: 920, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", color: "#8EACFF", fontSize: 18, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase" }}>
          Personalized learning, without the guesswork
        </div>
        <div style={{ marginTop: 22, display: "flex", fontSize: 76, fontWeight: 800, letterSpacing: -4, lineHeight: 1.04 }}>
          Know exactly what to study next.
        </div>
        <div style={{ maxWidth: 850, marginTop: 24, display: "flex", color: "#C8D2E8", fontSize: 27, lineHeight: 1.45 }}>
          YOVA turns your goals, materials, schedule, and progress into a clear plan, then guides you through it.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, color: "#B8C4DC", fontSize: 20 }}>
        <span style={{ color: "#FFFFFF", fontWeight: 700 }}>Plan</span>
        <span style={{ color: "#346BFF" }}>•</span>
        <span style={{ color: "#FFFFFF", fontWeight: 700 }}>Practice</span>
        <span style={{ color: "#7A5CFF" }}>•</span>
        <span style={{ color: "#FFFFFF", fontWeight: 700 }}>Adapt</span>
      </div>
    </div>
  );
}
