import { describe, expect, it } from "vitest";
import {
  conciseTeachingActivityTitle,
  extractLeadingMarkdownHeading,
  streamedLessonPresentation,
} from "@/lib/session-generation/activity-copy";

const AWKWARD_TRENCH_TITLE = "Learn Western Front trenches formed because repeated attacks under machine gun and artillery fire produced stalemate...";

describe("teaching activity copy", () => {
  it("never clips a complete explanatory claim into an interface title", () => {
    expect(conciseTeachingActivityTitle({
      preferredTitle: AWKWARD_TRENCH_TITLE,
    })).toBe("Your lesson model");
  });

  it("uses the mapped check heading when legacy teaching copy is a full claim", () => {
    expect(conciseTeachingActivityTitle({
      preferredTitle: AWKWARD_TRENCH_TITLE,
      alternateTitle: "Explain why trenches formed on the Western Front",
    })).toBe("Why trenches formed on the Western Front");
  });

  it("rejects a short answer-like claim but preserves a natural question heading", () => {
    expect(conciseTeachingActivityTitle({
      preferredTitle: "Trenches formed because defensive fire stopped repeated attacks",
    })).toBe("Your lesson model");
    expect(conciseTeachingActivityTitle({
      preferredTitle: "Why trenches formed on the Western Front",
    })).toBe("Why trenches formed on the Western Front");
    expect(conciseTeachingActivityTitle({
      preferredTitle: "Learn machine guns and artillery made attacks extremely costly",
    })).toBe("Your lesson model");
  });

  it("lifts the lesson's natural first heading and leaves later structure intact", () => {
    const presentation = streamedLessonPresentation({
      activityTitle: AWKWARD_TRENCH_TITLE,
      lessonContent: [
        "# Why Trenches Formed on the Western Front",
        "",
        "## Start with the causal chain",
        "",
        "Machine guns and artillery made attacks extremely costly.",
      ].join("\n"),
    });

    expect(presentation).toEqual({
      title: "Why Trenches Formed on the Western Front",
      content: "## Start with the causal chain\n\nMachine guns and artillery made attacks extremely costly.",
      liftedHeading: true,
    });
  });

  it("does not remove a heading that appears later in the lesson", () => {
    const content = "Opening context.\n\n## A later section";
    expect(extractLeadingMarkdownHeading(content)).toBeNull();
    expect(streamedLessonPresentation({
      activityTitle: "Teach the retrieval model",
      lessonContent: content,
    })).toEqual({
      title: "The retrieval model",
      content,
      liftedHeading: false,
    });
  });

  it("keeps an invalid opening heading in the lesson instead of hiding its topic", () => {
    const content = "# Trenches formed because defensive fire stopped attacks\n\nThe explanation follows.";
    expect(streamedLessonPresentation({
      activityTitle: AWKWARD_TRENCH_TITLE,
      lessonContent: content,
    })).toEqual({
      title: "Your lesson model",
      content,
      liftedHeading: false,
    });
  });

  it("waits for the heading line to finish before lifting it during streaming", () => {
    const partial = "# Why Trenches Formed";
    expect(streamedLessonPresentation({
      activityTitle: "Build the trench-warfare model",
      lessonContent: partial,
      streaming: true,
    })).toEqual({
      title: "The trench-warfare model",
      content: partial,
      liftedHeading: false,
    });

    expect(streamedLessonPresentation({
      activityTitle: "Build the trench-warfare model",
      lessonContent: `${partial}\n\n`,
      streaming: true,
    })).toEqual({
      title: "Why Trenches Formed",
      content: "",
      liftedHeading: true,
    });
  });
});
