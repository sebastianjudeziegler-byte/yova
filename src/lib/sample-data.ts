export type Question = {
  prompt: string;
  options: string[];
  optional?: boolean;
  multi?: boolean;
};

export const onboardingQuestions: Question[] = [
  {
    prompt: "What most often makes studying difficult?",
    options: ["I struggle to start", "I do not know what to do first", "I get distracted", "I study but do not retain enough", "I feel overwhelmed", "I try to make everything perfect", "It depends on the task"],
  },
  {
    prompt: "How much guidance do you want from YOVA?",
    options: ["Tell me exactly what to do", "Give me clear structure with flexibility", "Recommend options and let me decide"],
  },
  {
    prompt: "What study-session length usually feels realistic?",
    options: ["10 to 15 minutes", "20 to 30 minutes", "30 to 45 minutes", "45 to 60 minutes", "It depends"],
  },
  {
    prompt: "When a topic is difficult, what usually helps most?",
    options: ["A simple explanation first", "A concrete example first", "Step-by-step instructions", "Trying it and getting feedback", "A mixture"],
  },
  {
    prompt: "How often do you lose focus while studying?",
    options: ["Rarely", "Sometimes", "Often", "Very often"],
  },
  {
    prompt: "Which starting pattern sounds most like you?",
    options: ["I usually begin when I plan to", "I intend to begin but often delay", "I start when the deadline feels close", "I avoid planning because it feels larger", "It varies"],
  },
  {
    prompt: "When do you usually have the most usable energy?",
    options: ["Morning", "Afternoon", "Evening", "Late night", "It changes"],
  },
  {
    prompt: "What do you most want YOVA to improve?",
    options: ["Help me begin", "Tell me exactly what to do", "Help me remember more", "Help me learn difficult material", "Prepare efficiently for tests", "Help me stay consistent", "A combination"],
  },
  {
    prompt: "Is there a diagnosed condition that affects how you study?",
    options: ["ADHD", "Dyslexia", "Autism", "Anxiety affecting schoolwork", "Another condition", "None", "Prefer not to say"],
    optional: true,
  },
  {
    prompt: "Is there anything else YOVA should know?",
    options: ["I understand in class but forget during tests", "Long plans make me shut down", "I need examples before I feel ready", "Nothing else for now"],
    optional: true,
  },
];

export const sessions = [
  { title: "Build the comparison", method: "Guided learning", when: "Completed", duration: "25 min", status: "complete" },
  { title: "Retrieve cellular respiration", method: "Closed-note retrieval", when: "Today · Afternoon", duration: "20 min", status: "ready" },
  { title: "Apply and distinguish", method: "Mixed practice", when: "Tomorrow · Evening", duration: "30 min", status: "upcoming" },
  { title: "Practice test and repair", method: "Assessment", when: "Thursday · Evening", duration: "35 min", status: "upcoming" },
  { title: "Rapid recall", method: "Final review", when: "Friday · Morning", duration: "5 min", status: "upcoming" },
];

export const agenda = [
  { window: "Afternoon", title: "Retrieve cellular respiration", item: "AP Biology Unit 3", duration: "20 min", primary: true },
  { window: "Evening", title: "Worked examples: product rule", item: "Calculus derivatives", duration: "25 min", primary: false },
];
