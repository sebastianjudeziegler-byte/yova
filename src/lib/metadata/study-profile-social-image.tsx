import { readFile } from "node:fs/promises";
import { join } from "node:path";

const fontDirectory = join(process.cwd(), "node_modules", "@fontsource");
const interBold = readFile(
  join(fontDirectory, "inter", "files", "inter-latin-700-normal.woff"),
);
const newsreaderMedium = readFile(
  join(fontDirectory, "newsreader", "files", "newsreader-latin-500-normal.woff"),
);
const jetbrainsMonoBold = readFile(
  join(fontDirectory, "jetbrains-mono", "files", "jetbrains-mono-latin-700-normal.woff"),
);

export async function loadStudyProfileSocialFonts() {
  const [inter, newsreader, jetbrainsMono] = await Promise.all([
    interBold,
    newsreaderMedium,
    jetbrainsMonoBold,
  ]);

  return [
    {
      name: "Inter",
      data: inter,
      style: "normal" as const,
      weight: 700 as const,
    },
    {
      name: "Newsreader",
      data: newsreader,
      style: "normal" as const,
      weight: 500 as const,
    },
    {
      name: "JetBrains Mono",
      data: jetbrainsMono,
      style: "normal" as const,
      weight: 700 as const,
    },
  ];
}

export function StudyProfileSocialImage() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        padding: "48px 54px 50px",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        color: "#0b1020",
        background:
          "radial-gradient(circle at 89% 8%, rgba(143, 165, 255, 0.34) 0%, rgba(143, 165, 255, 0) 31%), radial-gradient(circle at 6% 94%, rgba(183, 210, 255, 0.3) 0%, rgba(183, 210, 255, 0) 35%), #f7f8fc",
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 18,
          display: "flex",
          border: "1px solid rgba(255, 255, 255, 0.92)",
          borderRadius: 28,
          background: "rgba(255, 255, 255, 0.32)",
        }}
      />

      <div
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(255, 255, 255, 0.8)",
              borderRadius: 16,
              background: "linear-gradient(145deg, #0b1020, #182446)",
            }}
          >
            <svg width="40" height="40" viewBox="0 0 48 48">
              <path
                d="M13 14.5 24 26l11-11.5M24 26v10"
                fill="none"
                stroke="#ffffff"
                strokeWidth="4.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M34 6v6M31 9h6"
                fill="none"
                stroke="#8facff"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div
            style={{
              marginLeft: 16,
              display: "flex",
              fontSize: 27,
              fontWeight: 700,
              letterSpacing: 6,
            }}
          >
            YOVA
          </div>
        </div>

        <div
          style={{
            padding: "11px 17px",
            display: "flex",
            color: "#2450c7",
            border: "1px solid rgba(36, 80, 199, 0.16)",
            borderRadius: 999,
            background: "rgba(255, 255, 255, 0.78)",
            fontFamily: "JetBrains Mono",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 1.2,
            textTransform: "uppercase",
          }}
        >
          Free · 14 questions · 3 minutes
        </div>
      </div>

      <div
        style={{
          width: "100%",
          flex: 1,
          marginTop: 35,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            width: 625,
            padding: "8px 4px 2px 0",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              color: "#2450c7",
              fontFamily: "JetBrains Mono",
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            Free YOVA Study Profile
          </div>
          <div
            style={{
              marginTop: 18,
              display: "flex",
              color: "#0b1020",
              fontFamily: "Newsreader",
              fontSize: 64,
              fontWeight: 500,
              letterSpacing: -1.8,
              lineHeight: 1.02,
            }}
          >
            Find your study pattern. Get a plan that fits.
          </div>
          <div
            style={{
              maxWidth: 575,
              marginTop: 20,
              display: "flex",
              color: "#475069",
              fontSize: 21,
              lineHeight: 1.45,
            }}
          >
            See the habit getting in your way, practical methods matched to
            your answers, and a plan you can use tonight.
          </div>
          <div
            style={{
              marginTop: 25,
              display: "flex",
              alignItems: "center",
              color: "#33415f",
              fontSize: 17,
            }}
          >
            <div
              style={{
                width: 23,
                height: 23,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                borderRadius: 999,
                background: "#2450c7",
                fontSize: 14,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16">
                <path
                  d="m3.5 8.1 2.8 2.8 6.2-6.2"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div style={{ marginLeft: 10, display: "flex" }}>
              No account required
            </div>
          </div>
        </div>

        <div
          style={{
            width: 405,
            padding: "30px 30px 27px",
            display: "flex",
            flexDirection: "column",
            border: "1px solid rgba(255, 255, 255, 0.34)",
            borderRadius: 24,
            color: "#ffffff",
            background:
              "radial-gradient(circle at 96% 4%, rgba(73, 111, 224, 0.72) 0%, rgba(73, 111, 224, 0) 43%), linear-gradient(145deg, #0b1020, #182446)",
          }}
        >
          <div
            style={{
              display: "flex",
              color: "#b9c8ff",
              fontFamily: "JetBrains Mono",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 1.4,
              textTransform: "uppercase",
            }}
          >
            Your named pattern
          </div>
          <div
            style={{
              marginTop: 15,
              display: "flex",
              fontFamily: "Newsreader",
              fontSize: 43,
              fontWeight: 500,
              lineHeight: 1.04,
            }}
          >
            The Stalled Starter
          </div>
          <div
            style={{
              marginTop: 13,
              display: "flex",
              color: "#d3dbef",
              fontSize: 18,
              lineHeight: 1.45,
            }}
          >
            Once you are in, you are fine. Starting is the wall.
          </div>

          <div
            style={{
              height: 1,
              margin: "22px 0 20px",
              display: "flex",
              background: "rgba(255, 255, 255, 0.17)",
            }}
          />

          <div
            style={{
              display: "flex",
              color: "#b9c8ff",
              fontFamily: "JetBrains Mono",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 1.2,
              textTransform: "uppercase",
            }}
          >
            Practical methods to try
          </div>
          <div
            style={{
              marginTop: 14,
              display: "flex",
              flexWrap: "wrap",
            }}
          >
            {[
              "Five-Minute Start",
              "Timeboxing",
              "Active Recall",
            ].map((method) => (
              <div
                key={method}
                style={{
                  margin: "0 8px 8px 0",
                  padding: "9px 12px",
                  display: "flex",
                  border: "1px solid rgba(255, 255, 255, 0.16)",
                  borderRadius: 999,
                  color: "#ffffff",
                  background: "rgba(255, 255, 255, 0.09)",
                  fontSize: 14,
                }}
              >
                {method}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
