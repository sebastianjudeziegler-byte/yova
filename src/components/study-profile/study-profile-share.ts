import type { StudyProfileReport } from "@/lib/study-profile";

export type StudyProfileShareFormat = "square" | "story";

export async function createStudyProfileShareImage(
  report: StudyProfileReport,
  format: StudyProfileShareFormat,
) {
  const width = 1080;
  const height = format === "story" ? 1920 : 1080;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not create the share image.");

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#0b1020");
  gradient.addColorStop(0.58, "#182446");
  gradient.addColorStop(1, "#2450c7");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const left = 88;
  const top = format === "story" ? 180 : 86;
  context.fillStyle = "rgba(255,255,255,0.72)";
  context.font = "700 24px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText("YOVA STUDY PROFILE", left, top);

  context.fillStyle = "#ffffff";
  context.font = "italic 700 82px Georgia, serif";
  const titleBottom = drawWrappedText(context, report.pattern.name, left, top + 96, width - 176, 92);

  context.fillStyle = "rgba(255,255,255,0.82)";
  context.font = "400 34px Inter, Arial, sans-serif";
  const tellBottom = drawWrappedText(context, report.pattern.tell, left, titleBottom + 44, width - 176, 48);

  const chartTop = Math.max(tellBottom + 74, format === "story" ? 760 : 510);
  const rowHeight = format === "story" ? 126 : 76;
  for (const [index, habit] of report.overview.entries()) {
    const y = chartTop + index * rowHeight;
    context.fillStyle = "rgba(255,255,255,0.76)";
    context.font = "600 25px Inter, Arial, sans-serif";
    context.fillText(habit.name, left, y);
    const active = habit.classification === "low" ? 1 : habit.classification === "moderate" ? 2 : 3;
    for (let segment = 1; segment <= 3; segment += 1) {
      context.fillStyle = segment <= active ? "#7ea6ff" : "rgba(255,255,255,0.15)";
      context.fillRect(left + (segment - 1) * 138, y + 22, 120, 14);
    }
    context.fillStyle = "rgba(255,255,255,0.62)";
    context.font = "500 22px Inter, Arial, sans-serif";
    context.fillText(habit.label, left + 448, y + 34);
  }

  context.fillStyle = "rgba(255,255,255,0.9)";
  context.font = "800 34px Inter, Arial, sans-serif";
  context.fillText("Find your pattern", left, height - 132);
  context.fillStyle = "rgba(255,255,255,0.66)";
  context.font = "500 25px Inter, Arial, sans-serif";
  context.fillText("yovaapp.com/study-profile", left, height - 82);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Your browser could not finish the share image."));
    }, "image/png");
  });
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(/\s+/);
  let line = "";
  let currentY = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = candidate;
    }
  }
  if (line) context.fillText(line, x, currentY);
  return currentY;
}
