import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Post-mortems and runbooks: rendered with the sheet's own typography.
// No raw HTML is rendered (react-markdown's default), so incident text
// can't inject markup.
export function Markdown({ source }: { source: string }) {
  return (
    <div className="measure text-base leading-7 text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="mb-3 mt-2 text-xl font-semibold tracking-[-0.02em]">{children}</h2>
          ),
          h2: ({ children }) => (
            <h3 className="mb-2 mt-7 border-b rule-strong pb-1 text-md font-semibold">
              {children}
            </h3>
          ),
          h3: ({ children }) => <h4 className="mb-2 mt-5 text-base font-semibold">{children}</h4>,
          p: ({ children }) => <p className="my-3">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-3 list-disc space-y-1 pl-5 marker:text-ink-3">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 list-decimal space-y-1 pl-5 marker:text-ink-3">{children}</ol>
          ),
          code: ({ children }) => (
            <code className="rounded-sm bg-panel px-1 py-0.5 font-mono text-xs">{children}</code>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="lettering border-b rule-strong py-1.5 pr-3 font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border-b rule py-1.5 pr-3 align-top">{children}</td>,
          a: ({ children, href }) => (
            <a href={href} className="underline" rel="noreferrer noopener" target="_blank">
              {children}
            </a>
          ),
          hr: () => <hr className="my-6 rule" />,
          em: ({ children }) => <em className="text-ink-2">{children}</em>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
