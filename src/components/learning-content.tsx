import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeRichMarkdown } from "@/lib/formatting/rich-markdown";

const inlineComponents: Components = {
  p: ({ children }) => <>{children}</>,
};

export function LearningContent({
  content,
  inline = false,
  className = "",
}: {
  content: string;
  inline?: boolean;
  className?: string;
}) {
  const normalized = normalizeRichMarkdown(content);
  const classes = ["learning-rich-text", inline ? "inline" : "", className]
    .filter(Boolean)
    .join(" ");
  const markdown = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={inline ? inlineComponents : undefined}
    >
      {normalized}
    </ReactMarkdown>
  );

  return inline
    ? <span className={classes}>{markdown}</span>
    : <div className={classes}>{markdown}</div>;
}
