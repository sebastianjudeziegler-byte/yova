export type PersonalizationInput = Readonly<{
  number: string;
  name: string;
  body: string;
  tag: "You tell it" | "It learns";
}>;

export type ProfileHabit = Readonly<{
  name: string;
  level: number;
  source: "answers" | "sessions";
}>;

export type LearningObservation = Readonly<{
  when: string;
  observation: string;
  change: string;
}>;

export type AgendaItem = Readonly<{
  day: string;
  title: string;
  meta: string;
  state: "missed" | "moved" | "unchanged";
}>;

export type ComparisonRow = Readonly<{
  row: string;
  cards: string;
  chat: string;
  yova: string;
}>;

export type FaqItem = Readonly<{
  question: string;
  answer: string;
}>;

export const inputs: readonly PersonalizationInput[] = [
  {
    number: "01",
    name: "Your Study Profile",
    body: "Fourteen questions on starting, structure, focus, self-checking, mistakes and stamina. The first read on your habits.",
    tag: "You tell it",
  },
  {
    number: "02",
    name: "Your goal and deadline",
    body: "A test on Thursday and a term-long course need different spacing. The deadline sets the shape of the plan.",
    tag: "You tell it",
  },
  {
    number: "03",
    name: "Your materials",
    body: "Notes, slides, PDFs or links. Sessions quote your own material back to you, so repairs use the words you learned with.",
    tag: "You tell it",
  },
  {
    number: "04",
    name: "Your schedule and energy window",
    body: "The hours you really have, and the part of the day your focus holds. Demanding work goes there first.",
    tag: "You tell it",
  },
  {
    number: "05",
    name: "Session completion patterns",
    body: "Which lengths you finish, which evenings you keep, where you tend to stop. Learned from completed sessions only.",
    tag: "It learns",
  },
  {
    number: "06",
    name: "Method preferences",
    body: "Which methods you stay with and which you override. Preferences are recorded and respected, then tested occasionally.",
    tag: "It learns",
  },
];

export const habits: readonly ProfileHabit[] = [
  { name: "Starting", level: 1, source: "answers" },
  { name: "Structure", level: 1, source: "answers" },
  { name: "Focus", level: 2, source: "sessions" },
  { name: "Checking what you know", level: 3, source: "sessions" },
  { name: "Handling mistakes", level: 1, source: "answers" },
  { name: "Session length", level: 2, source: "sessions" },
];

export const noticed: readonly LearningObservation[] = [
  {
    when: "After 6 sessions",
    observation: "You complete 20-minute sessions far more consistently than 40-minute ones.",
    change: "Default block length set to 20 minutes. Longer blocks are offered only when a task needs continuity.",
  },
  {
    when: "After 9 sessions",
    observation: "You miss evening sessions more often than afternoon sessions.",
    change: "New sessions are placed after 15:00 when your calendar allows. Evening slots become the fallback.",
  },
  {
    when: "After 11 sessions",
    observation: "Your confidence in biology runs ahead of your closed-notes recall.",
    change: "Biology sessions open with a short prediction, then a recall check, before any review.",
  },
];

export const agenda: readonly AgendaItem[] = [
  { day: "Wed 19:00", title: "Photosynthesis I", meta: "missed", state: "missed" },
  { day: "Thu 16:30", title: "Photosynthesis I", meta: "moved here", state: "moved" },
  { day: "Fri 16:30", title: "Photosynthesis II", meta: "moved here", state: "moved" },
  { day: "Sat 11:00", title: "Mixed recall · shortened", meta: "20 min", state: "unchanged" },
  { day: "Mon 07:30", title: "Final closed-notes check", meta: "test day", state: "unchanged" },
];

export const compare: readonly ComparisonRow[] = [
  {
    row: "Your habits and how you start",
    cards: "No",
    chat: "Only what you type each time",
    yova: "Study Profile, updated by completed sessions",
  },
  {
    row: "Your own materials",
    cards: "If you make the cards",
    chat: "If you paste them",
    yova: "Uploaded once, quoted back in sessions",
  },
  {
    row: "Your schedule and energy",
    cards: "Daily review count",
    chat: "No",
    yova: "Sessions placed in the windows you keep",
  },
  {
    row: "Which method to use tonight",
    cards: "Always spaced repetition",
    chat: "Whatever you ask for",
    yova: "Chosen per session, with the reason shown",
  },
  {
    row: "What happens after a missed day",
    cards: "Review pile grows",
    chat: "Nothing",
    yova: "Plan reflows, spacing and deadline preserved",
  },
  {
    row: "Proof you learned it",
    cards: "Self-graded",
    chat: "None",
    yova: "Closed-notes check ends every session",
  },
];

export const faq: readonly FaqItem[] = [
  {
    question: "Is this a learning-styles test?",
    answer: "No. The Study Profile records habits such as how you start, how long your focus holds and how you check what you know. These are preferences and patterns, and they change. Task requirements and checked work still decide what counts as learned.",
  },
  {
    question: "Do I need to upload my notes?",
    answer: "No. You can name a topic and YOVA creates the lesson material. If you do add notes, slides or PDFs, repairs and examples are drawn from them, which most people find more useful.",
  },
  {
    question: "How does YOVA decide the method?",
    answer: "It starts from your profile and your last result, chooses one method for the session, and shows the reason. If the first attempt reveals something different, it can switch mid-session. You can override any switch, and your choice is remembered.",
  },
  {
    question: "What happens when I skip a session?",
    answer: "The missed material moves into the windows you usually keep. Spacing between reviews and the deadline are preserved first; if that is impossible, YOVA shortens the final review and tells you.",
  },
  {
    question: "What do founding members get?",
    answer: "Access ahead of the public launch in the order you joined, a founding price held for twelve months, and a direct line to the team while the adaptive features are being tuned.",
  },
  {
    question: "What do you do with my email?",
    answer: "We send one confirmation link, then launch updates you have agreed to. Opening the link alone does not join you; you confirm with a visible action. Unsubscribe at any time.",
  },
];
