"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

type Props = {
  content: string;
  className?: string;
  tone?: "default" | "inverted";
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PluginList = any[];

export function ChatMarkdown({ content, className, tone = "default" }: Props) {
  const [plugins, setPlugins] = useState<{
    remarkPlugins: PluginList;
    rehypePlugins: PluginList;
  } | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadPlugins() {
      try {
        const [
          { default: remarkGfm },
          { default: remarkBreaks },
          { default: rehypeRaw },
          { default: rehypeHighlight },
          { default: rehypeSanitize, defaultSchema },
        ] = await Promise.all([
          import("remark-gfm"),
          import("remark-breaks"),
          import("rehype-raw"),
          import("rehype-highlight"),
          import("rehype-sanitize"),
        ]);

        if (!mounted) return;

        const sanitizeSchema = {
          ...defaultSchema,
          attributes: {
            ...defaultSchema.attributes,
            code: [...(defaultSchema.attributes?.code ?? []), "className"],
            span: [...(defaultSchema.attributes?.span ?? []), "className"],
            pre: [...(defaultSchema.attributes?.pre ?? []), "className"],
          },
        };

        setPlugins({
          remarkPlugins: [remarkGfm, remarkBreaks],
          rehypePlugins: [
            rehypeRaw,
            [rehypeHighlight, { detect: true, ignoreMissing: true }],
            [rehypeSanitize, sanitizeSchema],
          ],
        });
      } catch (err) {
        console.error("Failed to load markdown plugins", err);
      }
    }

    loadPlugins();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div
      className={cn(
        "chat-markdown prose prose-sm dark:prose-invert max-w-none",
        "prose-p:my-2 prose-pre:my-2 prose-ul:my-2 prose-ol:my-2",
        "prose-headings:mb-2 prose-headings:mt-4 first:prose-headings:mt-0",
        "prose-code:text-xs prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-muted prose-pre:text-foreground prose-pre:rounded-lg",
        tone === "inverted" && "prose-invert",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={plugins?.remarkPlugins ?? []}
        rehypePlugins={plugins?.rehypePlugins ?? []}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
