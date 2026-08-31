import type { StudyProfileDimensionReport } from "@/lib/study-profile";
import styles from "./study-profile.module.css";

type StudyProfileHabitChartProps = {
  overview: readonly StudyProfileDimensionReport[];
  compact?: boolean;
};

export function StudyProfileHabitChart({
  overview,
  compact = false,
}: StudyProfileHabitChartProps) {
  return (
    <div
      className={`${styles.habitChart} ${compact ? styles.habitChartCompact : ""}`}
      aria-label="Your six study habits"
    >
      {overview.map((habit) => {
        const active = habit.classification === "low"
          ? 1
          : habit.classification === "moderate"
            ? 2
            : 3;
        return (
          <div className={styles.habitChartRow} key={habit.dimension}>
            <span className={styles.habitChartLabel}>{habit.name}</span>
            <span className={styles.habitChartTrack} aria-hidden="true">
              {[1, 2, 3].map((segment) => (
                <i
                  className={segment <= active ? styles.habitChartSegmentActive : undefined}
                  key={segment}
                />
              ))}
            </span>
            <strong>{habit.label}</strong>
          </div>
        );
      })}
    </div>
  );
}
