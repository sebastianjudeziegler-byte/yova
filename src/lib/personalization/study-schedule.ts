export type StudyFrequency = "every_day" | "most_days" | "three_four" | "one_two";
export type StudyWindow = "Morning" | "Afternoon" | "Evening" | "Anytime";
export type StudySessionLength = 15 | 25 | 45 | 60;

export type StudyScheduleRecommendation = {
  frequency: StudyFrequency;
  window: StudyWindow;
  minutes: StudySessionLength;
  reason: string;
};

export function recommendStudySchedule(profileSummary: string): StudyScheduleRecommendation {
  const window = preferredWindow(profileSummary);
  const minutes = preferredMinutes(profileSummary);
  const benefitsFromFrequentStarts = /struggle to start|often delay|deadline feels close|long plans make me shut down|stay consistent/i.test(profileSummary);
  const frequency: StudyFrequency = benefitsFromFrequentStarts ? "most_days" : "three_four";

  const timingReason = window === "Anytime"
    ? "you have not established one reliable time of day yet"
    : `${window.toLowerCase()} is when you reported having the most usable energy`;

  return {
    frequency,
    window,
    minutes,
    reason: `YOVA recommends ${frequencyLabel(frequency).toLowerCase()} in ${minutes}-minute blocks because ${timingReason}. This is a starting recommendation, not a fixed rule.`,
  };
}

export function frequencyLabel(frequency: StudyFrequency) {
  if (frequency === "every_day") return "Every day";
  if (frequency === "most_days") return "Most days";
  if (frequency === "one_two") return "1–2 days";
  return "3–4 days";
}

export function frequencyIndexes(frequency: StudyFrequency) {
  if (frequency === "every_day") return [0, 1, 2, 3, 4, 5, 6];
  if (frequency === "most_days") return [0, 1, 2, 4, 5];
  if (frequency === "one_two") return [1, 4];
  return [0, 2, 4, 6];
}

export function deadlineDateFromGoal(goal: string, now = new Date()) {
  const date = new Date(now);
  const relativeMatch = goal.match(/\bin\s+(a|one|two|three|four|five|six|seven|\d+)\s+(day|days|week|weeks)\b/i);

  if (/\btomorrow\b/i.test(goal)) {
    date.setDate(date.getDate() + 1);
  } else if (relativeMatch) {
    const amount = numberFromWord(relativeMatch[1]);
    const multiplier = /week/i.test(relativeMatch[2]) ? 7 : 1;
    date.setDate(date.getDate() + amount * multiplier);
  } else if (/next friday|\bfriday\b/i.test(goal)) {
    const daysUntilFriday = (5 - date.getDay() + 7) % 7 || 7;
    date.setDate(date.getDate() + daysUntilFriday);
  } else {
    return "";
  }

  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function numberFromWord(value: string) {
  const words: Record<string, number> = {
    a: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
  };
  return words[value.toLowerCase()] ?? Number(value);
}

function preferredWindow(profileSummary: string): StudyWindow {
  const explicitAnswer = profileSummary.match(/When do you usually have the most usable energy\?\s*(Morning|Afternoon|Evening|Late night|It changes)/i)?.[1];
  if (/morning/i.test(explicitAnswer ?? "")) return "Morning";
  if (/afternoon/i.test(explicitAnswer ?? "")) return "Afternoon";
  if (/evening|late night/i.test(explicitAnswer ?? "")) return "Evening";
  if (/it changes/i.test(explicitAnswer ?? "")) return "Anytime";
  return "Anytime";
}

function preferredMinutes(profileSummary: string): StudySessionLength {
  const explicitAnswer = profileSummary.match(/What study-session length usually feels realistic\?\s*(10 to 15|20 to 30|30 to 45|45 to 60|It depends)/i)?.[1];
  if (/10 to 15/i.test(explicitAnswer ?? "")) return 15;
  if (/20 to 30/i.test(explicitAnswer ?? "")) return 25;
  if (/30 to 45/i.test(explicitAnswer ?? "")) return 45;
  if (/45 to 60/i.test(explicitAnswer ?? "")) return 60;
  return 25;
}
