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
    prompt: "When a school task looks difficult or uncomfortable, what is your first instinct?",
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
    prompt: "Which kind of instruction would make it easiest for you to begin?",
    options: [
      { id: "a", label: "Work on biology however you think is best.", score: 0 },
      { id: "b", label: "Study cellular respiration for 30 minutes.", score: 1 },
      { id: "c", label: "Review these three ideas, then test yourself.", score: 2 },
      { id: "d", label: "Start with these five questions. When you finish, move to the next step.", score: 3 },
    ],
  },
  {
    id: "q4",
    number: 4,
    dimension: "structure_need",
    prompt: "When you have several things you could study, what usually happens?",
    options: [
      { id: "a", label: "I quickly decide what matters most and begin.", score: 0 },
      { id: "b", label: "I make a rough plan and usually follow it.", score: 1 },
      { id: "c", label: "I spend too much time deciding what order to do things in.", score: 2 },
      { id: "d", label: "I bounce between things or struggle to begin any of them.", score: 3 },
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
    prompt: "Which is most likely to keep you engaged while studying?",
    options: [
      { id: "a", label: "A stable routine I can settle into.", score: 0 },
      { id: "b", label: "Seeing clear progress as I work.", score: 1 },
      { id: "c", label: "Switching between different kinds of active work.", score: 2 },
      { id: "d", label: "Short challenges, feedback, and frequent changes.", score: 3 },
    ],
  },
  {
    id: "q7",
    number: 7,
    dimension: "calibration_risk",
    prompt: "After rereading notes until the material feels familiar, what usually happens when you close them and try to explain it?",
    options: [
      { id: "a", label: "I can usually explain it accurately.", score: 0 },
      { id: "b", label: "I remember most of it but notice some gaps.", score: 1 },
      { id: "c", label: "It is unpredictable.", score: 2 },
      { id: "d", label: "I often realize I knew much less than it felt like I knew.", score: 3 },
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
    prompt: "When you’re unsure of an answer while practicing, what are you most likely to do?",
    options: [
      { id: "a", label: "Commit to an answer and see what happens.", score: 0 },
      { id: "b", label: "Think about it for a while, then answer.", score: 1 },
      { id: "c", label: "Check notes or hints before committing.", score: 2 },
      { id: "d", label: "Avoid answering until I feel confident I’m right.", score: 3 },
    ],
  },
  {
    id: "q10",
    number: 10,
    dimension: "mistake_sensitivity",
    prompt: "Which sounds most like you?",
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
    prompt: "During demanding studying, how does your performance usually change as the session gets longer?",
    options: [
      { id: "a", label: "It stays fairly consistent.", score: 0 },
      { id: "b", label: "I fade somewhat after a while.", score: 1 },
      { id: "c", label: "I noticeably lose accuracy or focus after roughly 20–30 minutes.", score: 2 },
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
