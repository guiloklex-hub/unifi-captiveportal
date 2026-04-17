"use client";

import ReactMarkdown from "react-markdown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export function TermsModal({ terms, dict }: { terms?: string | null; dict: Dictionary }) {
  if (!terms) {
    return (
      <span className="font-semibold text-primary hover:underline underline-offset-4">
        {dict.portal.termsLink}
      </span>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <span className="font-semibold text-primary hover:underline underline-offset-4 cursor-pointer" onClick={(e) => e.stopPropagation()}>
          {dict.portal.termsLink}
        </span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>{dict.portal.termsLink}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
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
        </div>
        <DialogFooter className="p-6 pt-2">
          <DialogClose asChild>
            <Button type="button" variant="secondary" className="w-full sm:w-auto">
              {dict.portal.close}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
