"use client";

import ReactMarkdown from "react-markdown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function TermsModal({ terms }: { terms: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="underline hover:text-primary transition-colors">
          termos de uso
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[90vw] sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Termos de Uso e Privacidade</DialogTitle>
        </DialogHeader>
        <div className="prose prose-sm dark:prose-invert mt-4">
          <ReactMarkdown
            components={{
              h1: ({node, ...props}) => <h1 className="text-xl font-bold mb-4" {...props} />,
              h2: ({node, ...props}) => <h2 className="text-lg font-bold mb-3" {...props} />,
              p: ({node, ...props}) => <p className="mb-4 leading-relaxed" {...props} />,
              ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4" {...props} />,
              li: ({node, ...props}) => <li className="mb-1" {...props} />,
            }}
          >
            {terms}
          </ReactMarkdown>
        </div>
      </DialogContent>
    </Dialog>
  );
}
