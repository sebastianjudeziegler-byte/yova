import {
  agencyModeForStudyRouteControlMode,
  type StudyRouteAgencyMode,
} from "@/lib/study-route/agency-mode-controller";
import { type StudyRoute } from "@/lib/study-route/schema";
import { visibleStudyRouteRecipe } from "@/lib/study-route/visible-recipe";
import styles from "./study-route-recipe-card.module.css";

export function StudyRouteRecipeCard({
  route,
  previousRoute = null,
  showAlternatives = true,
}: {
  route: StudyRoute;
  previousRoute?: StudyRoute | null;
  showAlternatives?: boolean;
}) {
  const recipe = visibleStudyRouteRecipe({ route, previousRoute });
  const agency = agencyModeForStudyRouteControlMode(route.agency.controlMode);
  const agencyCopy = agencyModeCopy(agency.mode);

  return (
    <section
      className={styles.card}
      aria-label={`Study recipe: ${recipe.collapsed.primaryMethod}`}
    >
      <header>
        <div>
          <span className={styles.mode}>{agencyCopy.label}</span>
          <strong>{recipe.collapsed.sessionType} · {recipe.collapsed.primaryMethod}</strong>
          <small>{recipe.collapsed.totalMinutes} minutes total</small>
        </div>
        <p>{agencyCopy.explanation}</p>
      </header>
      <p className={styles.reason}>{recipe.collapsed.shortReason}</p>
      <details>
        <summary>See the complete recipe</summary>
        <div className={styles.expanded}>
          <ol>
            {recipe.expanded.phases.map((phase) => (
              <li key={phase.phaseId}>
                <span>{phase.name}</span>
                <strong>{phase.activeMinutes} min</strong>
              </li>
            ))}
          </ol>
          <p>
            {recipe.expanded.activeMinutes} focused minutes
            {recipe.expanded.elapsedMinutes !== recipe.expanded.activeMinutes
              ? ` · ${recipe.expanded.elapsedMinutes} minutes elapsed`
              : ""}
          </p>
          {recipe.expanded.timedBreak && (
            <p>
              Optional {recipe.expanded.timedBreak.minutes}-minute timed break
              after {visiblePhaseLabel(recipe.expanded.timedBreak.afterPhaseId)}.
            </p>
          )}
          {recipe.expanded.changedSincePrevious && (
            <div className={styles.changed}>
              <strong>What changed</strong>
              <p>{recipe.expanded.changedSincePrevious.summary}</p>
            </div>
          )}
          {showAlternatives && recipe.expanded.alternatives.length > 0 && (
            <div className={styles.alternatives}>
              <strong>Other valid recipes</strong>
              {recipe.expanded.alternatives.map((alternative) => (
                <p key={alternative.alternativeId}>
                  <b>{alternative.methodName}</b> · {alternative.tradeoff}
                </p>
              ))}
            </div>
          )}
          {agency.uncertainty && <p className={styles.uncertainty}>{agency.uncertainty}</p>}
        </div>
      </details>
    </section>
  );
}

export function agencyModeCopy(mode: StudyRouteAgencyMode) {
  if (mode === "help_me_choose") {
    return {
      label: "Help Me Choose",
      explanation: "YOVA recommends one valid recipe; your exact choice is confirmed before it is saved.",
    } as const;
  }
  if (mode === "ill_customize") {
    return {
      label: "I’ll Customize",
      explanation: "You choose among the bounded recipes that remain valid for this task.",
    } as const;
  }
  return {
    label: "YOVA Decides",
    explanation: "YOVA selects the strongest supported route and keeps the reason visible.",
  } as const;
}

function visiblePhaseLabel(phaseId: string) {
  return phaseId.replaceAll("_", " ");
}
