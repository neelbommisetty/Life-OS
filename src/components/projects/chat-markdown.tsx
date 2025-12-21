"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Schema } from "hast-util-sanitize";
import { cn } from "@/lib/utils";

const sanitizeSchema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
    pre: [...(defaultSchema.attributes?.pre ?? []), "className"],
  },
};

type Props = {
  content: string;
  className?: string;
  tone?: "default" | "inverted";
};

export function ChatMarkdown({ content, className, tone = "default" }: Props) {
  return (
    <div
      className={cn(
        "chat-markdown",
        tone === "inverted" && "chat-markdown--inverted",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
          [rehypeSanitize, sanitizeSchema],
        ]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
