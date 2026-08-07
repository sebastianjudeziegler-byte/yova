import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeRichMarkdown } from "@/lib/formatting/rich-markdown";

export function TutorMessageContent({ content }: { content: string }) {
  return (
    <div className="tutor-rich-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {normalizeRichMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}
