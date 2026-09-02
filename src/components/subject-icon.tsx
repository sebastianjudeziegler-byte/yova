import {
  Atom,
  BadgeDollarSign,
  BookMarked,
  Calculator,
  Code2,
  Dna,
  FlaskConical,
  Globe2,
  Landmark,
  Microscope,
} from "lucide-react";
import type { LearningPlan } from "@/lib/domain";

export function SubjectIcon({ plan, compact = false }: { plan: LearningPlan; compact?: boolean }) {
  const text = `${plan.title} ${plan.topic}`.toLocaleLowerCase();
  const subject = /bio|cell|anatom|health|nutrition|photosynth|respirat/.test(text)
    ? { Icon: Dna, theme: "life" }
    : /chem|molecule|reaction|organic/.test(text)
      ? { Icon: FlaskConical, theme: "chemistry" }
      : /calc|math|algebra|geometry|derivative|statistic/.test(text)
        ? { Icon: Calculator, theme: "math" }
        : /physics|force|motion|energy|electric|thermodynam|entropy|heat transfer/.test(text)
          ? { Icon: Atom, theme: "physics" }
          : /history|government|politic|civic|law|essay|literature|writing|world war/.test(text)
            ? { Icon: Landmark, theme: "humanities" }
            : /finance|business|economic|invest|account/.test(text)
              ? { Icon: BadgeDollarSign, theme: "finance" }
              : /code|program|software|computer|javascript|python/.test(text)
                ? { Icon: Code2, theme: "computing" }
                : /geograph|world|environment/.test(text)
                  ? { Icon: Globe2, theme: "world" }
                  : /science|research|lab/.test(text)
                    ? { Icon: Microscope, theme: "life" }
                    : { Icon: BookMarked, theme: "general" };
  const SubjectGlyph = subject.Icon;
  return <span className={`subject-icon ${subject.theme} ${compact ? "compact" : ""}`} aria-hidden="true"><SubjectGlyph size={compact ? 18 : 20} /></span>;
}
