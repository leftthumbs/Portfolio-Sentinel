import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, FileText, Loader2, Mail, Presentation, Search, AlertCircle } from "lucide-react";

interface LibraryAttachment {
  filename: string;
  mimeType: string;
  size: number;
}

interface LibraryMessage {
  uid: number;
  subject: string;
  from: string;
  fromAddress: string;
  date: string;
  attachments: LibraryAttachment[];
  docSendLinks: string[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

export default function InvestmentLibraryPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery<{ messages: LibraryMessage[] }>({
    queryKey: ["/api/library/messages"],
    queryFn: async () => {
      const res = await fetch("/api/library/messages?limit=100", { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to read the Investment Library");
      }
      return res.json();
    },
  });

  const messages = data?.messages ?? [];
  const term = search.trim().toLowerCase();
  const filtered = term
    ? messages.filter(
        (m) =>
          m.subject.toLowerCase().includes(term) ||
          m.from.toLowerCase().includes(term) ||
          m.attachments.some((a) => a.filename.toLowerCase().includes(term)),
      )
    : messages;

  const documentCount = messages.reduce((n, m) => n + m.attachments.length, 0);
  const docSendCount = messages.reduce((n, m) => n + m.docSendLinks.length, 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="heading-investment-library">
          <Mail className="h-6 w-6" />
          Investment Library
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fund documents from the "Investment Library" label in Gmail. Read-only — opening a
          document here does not mark the email as read.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base font-medium">Documents</CardTitle>
              {!isLoading && !error && (
                <CardDescription>
                  {documentCount} attachment{documentCount === 1 ? "" : "s"} across{" "}
                  {messages.length} message{messages.length === 1 ? "" : "s"}
                  {docSendCount > 0 && ` · ${docSendCount} DocSend link${docSendCount === 1 ? "" : "s"}`}
                </CardDescription>
              )}
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search by fund, sender or filename..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-library-search"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center py-12 gap-3 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Cannot read the Investment Library</p>
              <p className="text-sm text-muted-foreground max-w-lg">{(error as Error).message}</p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              {term ? "No documents match that search." : "No documents found under the label yet."}
            </p>
          ) : (
            <div className="divide-y">
              {filtered.map((m) => (
                <div key={m.uid} className="py-4 space-y-2" data-testid={`library-message-${m.uid}`}>
                  <div className="flex items-baseline justify-between gap-4 flex-wrap">
                    <p className="font-medium leading-snug">{m.subject}</p>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(m.date)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{m.from}</p>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {m.attachments.map((a) => (
                      <Button
                        key={a.filename}
                        variant="outline"
                        size="sm"
                        asChild
                        data-testid={`download-${m.uid}-${a.filename}`}
                      >
                        <a
                          href={`/api/library/messages/${m.uid}/attachments/${encodeURIComponent(a.filename)}`}
                        >
                          <FileText className="h-3.5 w-3.5 mr-1.5" />
                          {a.filename}
                          <span className="ml-1.5 text-muted-foreground">{formatSize(a.size)}</span>
                          <Download className="h-3.5 w-3.5 ml-1.5" />
                        </a>
                      </Button>
                    ))}

                    {m.docSendLinks.map((link) => (
                      <Badge key={link} variant="secondary" className="font-normal">
                        <Presentation className="h-3.5 w-3.5 mr-1.5" />
                        <a href={link} target="_blank" rel="noopener noreferrer" className="underline">
                          DocSend room
                        </a>
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
