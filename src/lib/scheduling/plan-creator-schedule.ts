import {
  frequencyIndexes,
  type StudyFrequency,
  type StudySessionLength,
  type StudyWindow,
} from "@/lib/personalization/study-schedule";

export type AvailabilityChoice = {
  day: string;
  dateLabel: string;
  window: "Morning" | "Afternoon" | "Evening";
  minutes: number;
  enabled: boolean;
};

export type PlanCreatorScheduleState = {
  deadlineDate: string;
  studyFrequency: StudyFrequency;
  preferredWindows: StudyWindow[];
  sessionLength: StudySessionLength;
  customScheduleOpen: boolean;
  availabilityChoices: AvailabilityChoice[];
  recommendedWindow: StudyWindow;
};

export type PlanCreatorScheduleAction =
  | { type: "set_deadline"; deadlineDate: string }
  | { type: "choose_frequency"; frequency: StudyFrequency }
  | { type: "toggle_window"; window: StudyWindow }
  | { type: "choose_session_length"; minutes: StudySessionLength }
  | { type: "set_custom_open"; open: boolean }
  | { type: "toggle_day"; index: number }
  | { type: "set_day_window"; index: number; window: AvailabilityChoice["window"] }
  | { type: "set_day_minutes"; index: number; minutes: number };

/**
 * Keeps the learner's calendar choice independent from rhythm changes. Every
 * quick-choice transition rebuilds availability from the same state snapshot,
 * while deadline actions change only the deadline.
 */
export function planCreatorScheduleReducer(
  state: PlanCreatorScheduleState,
  action: PlanCreatorScheduleAction,
): PlanCreatorScheduleState {
  if (action.type === "set_deadline") {
    return { ...state, deadlineDate: action.deadlineDate };
  }
  if (action.type === "set_custom_open") {
    return { ...state, customScheduleOpen: action.open };
  }
  if (action.type === "toggle_day") {
    return {
      ...state,
      availabilityChoices: updateChoice(state.availabilityChoices, action.index, (choice) => ({
        ...choice,
        enabled: !choice.enabled,
      })),
    };
  }
  if (action.type === "set_day_window") {
    return {
      ...state,
      availabilityChoices: updateChoice(state.availabilityChoices, action.index, (choice) => ({
        ...choice,
        window: action.window,
      })),
    };
  }
  if (action.type === "set_day_minutes") {
    return {
      ...state,
      availabilityChoices: updateChoice(state.availabilityChoices, action.index, (choice) => ({
        ...choice,
        minutes: action.minutes,
      })),
    };
  }

  if (action.type === "choose_frequency") {
    return rebuildQuickSchedule(state, {
      frequency: action.frequency,
      windows: state.preferredWindows,
      minutes: state.sessionLength,
    });
  }
  if (action.type === "toggle_window") {
    return rebuildQuickSchedule(state, {
      frequency: state.studyFrequency,
      windows: toggledWindows(state.preferredWindows, action.window),
      minutes: state.sessionLength,
    });
  }
  return rebuildQuickSchedule(state, {
    frequency: state.studyFrequency,
    windows: state.preferredWindows,
    minutes: action.minutes,
  });
}

export function configureAvailability(
  choices: AvailabilityChoice[],
  frequency: StudyFrequency,
  windows: StudyWindow[],
  minutes: StudySessionLength,
  recommendedWindow: StudyWindow,
) {
  const enabledIndexes = frequencyIndexes(frequency);
  const concreteWindows = windows.includes("Anytime")
    ? [recommendedWindow === "Anytime" ? "Afternoon" : recommendedWindow]
    : windows.filter((window): window is AvailabilityChoice["window"] => window !== "Anytime");
  return choices.map((choice, index) => ({
    ...choice,
    enabled: enabledIndexes.includes(index),
    window: concreteWindows[index % concreteWindows.length] ?? "Afternoon",
    minutes,
  }));
}

function rebuildQuickSchedule(
  state: PlanCreatorScheduleState,
  next: {
    frequency: StudyFrequency;
    windows: StudyWindow[];
    minutes: StudySessionLength;
  },
): PlanCreatorScheduleState {
  return {
    ...state,
    studyFrequency: next.frequency,
    preferredWindows: next.windows,
    sessionLength: next.minutes,
    customScheduleOpen: false,
    availabilityChoices: configureAvailability(
      state.availabilityChoices,
      next.frequency,
      next.windows,
      next.minutes,
      state.recommendedWindow,
    ),
  };
}

function toggledWindows(current: StudyWindow[], window: StudyWindow): StudyWindow[] {
  if (window === "Anytime") return ["Anytime"];
  if (current.includes(window)) {
    return current.length === 1 ? current : current.filter((item) => item !== window);
  }
  return [...current.filter((item) => item !== "Anytime"), window];
}

function updateChoice(
  choices: AvailabilityChoice[],
  index: number,
  update: (choice: AvailabilityChoice) => AvailabilityChoice,
) {
  return choices.map((choice, choiceIndex) => choiceIndex === index ? update(choice) : choice);
}
