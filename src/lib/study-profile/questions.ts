import type { StudyProfileQuestion } from "@/lib/study-profile/types";

export const STUDY_PROFILE_QUESTIONS = [
  {
    id: "q1",
    number: 1,
    dimension: "starting_friction",
    prompt: "You planned to start studying at 7:00. What most often happens?",
    options: [
      { id: "a", label: "I usually start around when I planned.", score: 0 },
      { id: "b", label: "I delay a little, but normally get going.", score: 1 },
      { id: "c", label: "I find other things to do first and lose a lot of time.", score: 2 },
      { id: "d", label: "I often don’t start until pressure forces me to.", score: 3 },
    ],
  },
  {
    id: "q2",
    number: 2,
    dimension: "starting_friction",
    prompt: "When schoolwork looks difficult or uncomfortable, what do you usually do first?",
    options: [
      { id: "a", label: "Start somewhere and figure it out as I go.", score: 0 },
      { id: "b", label: "Get a little more information before trying.", score: 1 },
      { id: "c", label: "Put it off until I feel more prepared.", score: 2 },
      { id: "d", label: "Switch to something easier or avoid it for a while.", score: 3 },
    ],
  },
  {
    id: "q3",
    number: 3,
    dimension: "structure_need",
    prompt: "A task says \"review this topic\" with no steps. What usually happens?",
    options: [
      { id: "a", label: "I choose a sensible first step and begin.", score: 0 },
      { id: "b", label: "I write a short checklist, then start.", score: 0 },
      { id: "c", label: "I spend longer than planned looking for examples or clearer instructions.", score: 2 },
      { id: "d", label: "I often wait until someone breaks it into exact steps for me.", score: 3 },
    ],
  },
  {
    id: "q4",
    number: 4,
    dimension: "structure_need",
    prompt: "Pick the one closest to your last busy school week.",
    options: [
      { id: "a", label: "I chose the most important task first, then adjusted as I went.", score: 0 },
      { id: "b", label: "I made a rough plan, even though the order changed a little.", score: 1 },
      { id: "c", label: "I kept revising the plan and lost useful time deciding.", score: 2 },
      { id: "d", label: "I opened whatever felt urgent and switched between tasks.", score: 3 },
    ],
  },
  {
    id: "q5",
    number: 5,
    dimension: "attention_variability",
    prompt: "During a longer study session on one topic, what usually happens?",
    options: [
      { id: "a", label: "My attention stays fairly steady.", score: 0 },
      { id: "b", label: "It gradually drops, but I can continue.", score: 1 },
      { id: "c", label: "I start wanting a change of activity fairly quickly.", score: 2 },
      { id: "d", label: "I frequently drift, switch tabs, check my phone, or lose the thread.", score: 3 },
    ],
  },
  {
    id: "q6",
    number: 6,
    dimension: "attention_variability",
    prompt: "When your attention slips during a study block, what usually happens next?",
    options: [
      { id: "a", label: "I notice it and bring myself back to the same task.", score: 0 },
      { id: "b", label: "I take a planned short reset, then return.", score: 0 },
      { id: "c", label: "I switch between questions, diagrams, or explanation to re-engage.", score: 1 },
      { id: "d", label: "I drift into unrelated tabs or my phone and struggle to return.", score: 3 },
    ],
  },
  {
    id: "q7",
    number: 7,
    dimension: "calibration_risk",
    prompt: "Which is closer to what you do before a test?",
    options: [
      { id: "a", label: "I redo questions I missed until I can answer them alone.", score: 0 },
      { id: "b", label: "I alternate short self-tests with targeted review.", score: 0 },
      { id: "c", label: "I explain topics aloud, then check my notes when I stall.", score: 1 },
      { id: "d", label: "I reread everything once more so nothing feels unfamiliar.", score: 3 },
    ],
  },
  {
    id: "q8",
    number: 8,
    dimension: "calibration_risk",
    prompt: "How well does your confidence before a test usually match the result?",
    options: [
      { id: "a", label: "Pretty closely.", score: 0, calibrationDirection: "relatively_calibrated" },
      { id: "b", label: "I am sometimes surprised, but not by much.", score: 1, calibrationDirection: "mixed" },
      { id: "c", label: "I often feel prepared and score worse than expected.", score: 3, calibrationDirection: "overconfidence_risk" },
      { id: "d", label: "I often think I’m unprepared and then perform better than expected.", score: 3, calibrationDirection: "underconfidence_risk" },
    ],
  },
  {
    id: "q9",
    number: 9,
    dimension: "mistake_sensitivity",
    prompt: "In a normal week, how often do you check notes before committing to a practice answer?",
    options: [
      { id: "a", label: "Rarely. I usually answer first and check afterward.", score: 0 },
      { id: "b", label: "Sometimes, after I have thought about it for a while.", score: 1 },
      { id: "c", label: "Often, because I want a hint before I commit.", score: 2 },
      { id: "d", label: "Almost every time I am not confident I am right.", score: 3 },
    ],
  },
  {
    id: "q10",
    number: 10,
    dimension: "mistake_sensitivity",
    prompt: "You have finished a piece of work but it is not quite right yet. What usually happens?",
    options: [
      { id: "a", label: "I would rather make a rough attempt and improve it.", score: 0 },
      { id: "b", label: "I usually balance getting started with getting things right.", score: 1 },
      { id: "c", label: "I spend longer than I should making work feel complete before moving on.", score: 2 },
      { id: "d", label: "I sometimes delay starting or submitting because I don’t think it is good enough yet.", score: 3 },
    ],
  },
  {
    id: "q11",
    number: 11,
    dimension: "cognitive_stamina",
    prompt: "What happens as a demanding study session gets longer?",
    options: [
      { id: "a", label: "It stays fairly consistent.", score: 0 },
      { id: "b", label: "I fade somewhat after a while.", score: 1 },
      { id: "c", label: "I noticeably lose accuracy or focus after roughly 20 to 30 minutes.", score: 2 },
      { id: "d", label: "Long sessions break down quickly unless I reset or take breaks.", score: 3 },
    ],
  },
  {
    id: "q12",
    number: 12,
    dimension: "cognitive_stamina",
    prompt: "How much does the time of day affect your ability to do difficult schoolwork?",
    options: [
      { id: "a", label: "Not much.", score: 0 },
      { id: "b", label: "There is a slight difference.", score: 1 },
      { id: "c", label: "I have a noticeably stronger part of the day.", score: 2 },
      { id: "d", label: "My ability changes dramatically depending on timing, fatigue, or energy.", score: 3 },
    ],
  },
] as const satisfies readonly StudyProfileQuestion[];

export const STUDY_PROFILE_QUESTION_BY_ID = Object.fromEntries(
  STUDY_PROFILE_QUESTIONS.map((question) => [question.id, question]),
) as Record<(typeof STUDY_PROFILE_QUESTIONS)[number]["id"], (typeof STUDY_PROFILE_QUESTIONS)[number]>;
