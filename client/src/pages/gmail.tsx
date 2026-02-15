import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Mail,
  Inbox,
  Send,
  Search,
  RefreshCw,
  Loader2,
  Paperclip,
  Star,
  Clock,
  ChevronRight,
  X,
  MailOpen,
  AlertCircle,
} from "lucide-react";

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  labelIds: string[];
  isUnread: boolean;
  hasAttachment: boolean;
}

interface GmailLabel {
  id: string;
  name: string;
  type: string;
  messagesTotal: number;
  messagesUnread: number;
}

function formatDate(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (days === 1) {
    return "Yesterday";
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

function extractSenderName(from: string): string {
  const match = from.match(/^([^<]+)/);
  if (match) {
    return match[1].trim().replace(/"/g, "");
  }
  return from.split("@")[0];
}

export default function GmailPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<GmailMessage | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [activeLabel, setActiveLabel] = useState("INBOX");

  const { data: messagesData, isLoading: messagesLoading, error: messagesError, refetch: refetchMessages } = useQuery<{
    messages: GmailMessage[];
  }>({
    queryKey: ["/api/gmail/messages", activeLabel],
    queryFn: async () => {
      const labelQuery = activeLabel !== "ALL" ? `label:${activeLabel}` : "";
      const res = await fetch(`/api/gmail/messages?q=${encodeURIComponent(labelQuery)}&maxResults=30`);
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
  });

  const { data: labelsData, isLoading: labelsLoading } = useQuery<{
    labels: GmailLabel[];
  }>({
    queryKey: ["/api/gmail/labels"],
  });

  const { data: messageDetail, isLoading: messageDetailLoading } = useQuery<{
    message: GmailMessage;
    body: string;
  }>({
    queryKey: ["/api/gmail/messages", selectedMessage?.id],
    enabled: !!selectedMessage,
  });

  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      const res = await fetch(`/api/gmail/search?q=${encodeURIComponent(query)}&maxResults=30`);
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/gmail/messages", activeLabel], data);
    },
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (messageId: string) => {
      return apiRequest("POST", `/api/gmail/messages/${messageId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/labels"] });
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async (data: { to: string; subject: string; body: string }) => {
      return apiRequest("POST", "/api/gmail/send", data);
    },
    onSuccess: () => {
      setShowCompose(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      toast({
        title: "Email sent",
        description: "Your email has been sent successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to send email",
        description: error.message,
      });
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      searchMutation.mutate(searchQuery);
    }
  };

  const handleMessageClick = (message: GmailMessage) => {
    setSelectedMessage(message);
    if (message.isUnread) {
      markAsReadMutation.mutate(message.id);
    }
  };

  const handleSendEmail = () => {
    if (!composeTo || !composeSubject || !composeBody) {
      toast({
        variant: "destructive",
        title: "Missing fields",
        description: "Please fill in all fields before sending.",
      });
      return;
    }
    sendEmailMutation.mutate({ to: composeTo, subject: composeSubject, body: composeBody });
  };

  const messages = messagesData?.messages || [];
  const labels = labelsData?.labels || [];
  
  const importantLabels = labels.filter(l => 
    ["INBOX", "SENT", "DRAFT", "STARRED", "IMPORTANT", "SPAM", "TRASH"].includes(l.id)
  );

  const inboxLabel = labels.find(l => l.id === "INBOX");
  const unreadCount = inboxLabel?.messagesUnread || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Mail className="h-8 w-8" />
            Gmail
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your investment-related emails
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => refetchMessages()}
            disabled={messagesLoading}
            data-testid="button-refresh-gmail"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${messagesLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={() => setShowCompose(true)} data-testid="button-compose">
            <Send className="h-4 w-4 mr-2" />
            Compose
          </Button>
        </div>
      </div>

      <div className="flex gap-6">
        <Card className="w-56 shrink-0" data-testid="card-labels">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Inbox className="h-4 w-4" />
              Labels
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-2">
            {labelsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {importantLabels.map((label) => (
                  <Button
                    key={label.id}
                    variant={activeLabel === label.id ? "secondary" : "ghost"}
                    className="w-full justify-between h-9"
                    onClick={() => setActiveLabel(label.id)}
                    data-testid={`button-label-${label.id.toLowerCase()}`}
                  >
                    <span className="truncate">{label.name}</span>
                    {label.messagesUnread > 0 && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        {label.messagesUnread}
                      </Badge>
                    )}
                  </Button>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex-1 space-y-4">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search emails..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-gmail"
              />
            </div>
            <Button type="submit" disabled={searchMutation.isPending} data-testid="button-search-gmail">
              {searchMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Search"
              )}
            </Button>
          </form>

          <Card data-testid="card-messages">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  {activeLabel === "INBOX" ? "Inbox" : activeLabel}
                  {unreadCount > 0 && activeLabel === "INBOX" && (
                    <Badge variant="default" className="ml-2">
                      {unreadCount} unread
                    </Badge>
                  )}
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {messages.length} messages
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {messagesError ? (
                <div className="flex flex-col items-center justify-center py-16 gap-4 px-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                    <AlertCircle className="h-8 w-8 text-destructive" />
                  </div>
                  <div className="text-center space-y-2 max-w-md">
                    <p className="font-medium">Gmail Connection Required</p>
                    <p className="text-sm text-muted-foreground">
                      Unable to connect to Gmail. This feature requires a Google OAuth connection to be configured
                      in your environment. The Gmail API needs valid OAuth credentials (access token) to read and send emails.
                    </p>
                    <p className="text-xs text-muted-foreground mt-3">
                      If running on Replit, enable the Gmail connector in the Connections panel. Otherwise, ensure the
                      required environment variables (<code className="bg-muted px-1 py-0.5 rounded text-xs">REPLIT_CONNECTORS_HOSTNAME</code>,{" "}
                      <code className="bg-muted px-1 py-0.5 rounded text-xs">REPL_IDENTITY</code>) are set.
                    </p>
                  </div>
                </div>
              ) : messagesLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <MailOpen className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">No emails found</p>
                </div>
              ) : (
                <div className="divide-y">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex items-center gap-4 p-4 hover-elevate cursor-pointer ${
                        message.isUnread ? "bg-primary/5" : ""
                      }`}
                      onClick={() => handleMessageClick(message)}
                      data-testid={`row-message-${message.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`font-medium truncate ${message.isUnread ? "font-semibold" : ""}`}>
                            {extractSenderName(message.from)}
                          </span>
                          {message.hasAttachment && (
                            <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                          )}
                          {message.labelIds?.includes("STARRED") && (
                            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 shrink-0" />
                          )}
                        </div>
                        <p className={`text-sm truncate ${message.isUnread ? "font-medium" : "text-muted-foreground"}`}>
                          {message.subject || "(No subject)"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {message.snippet}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(message.date)}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!selectedMessage} onOpenChange={(open) => !open && setSelectedMessage(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="pr-8">{selectedMessage?.subject || "(No subject)"}</DialogTitle>
            <DialogDescription className="flex items-center gap-4 pt-2">
              <span className="font-medium">{extractSenderName(selectedMessage?.from || "")}</span>
              <span className="text-xs flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {selectedMessage?.date}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto mt-4 p-4 bg-muted/30 rounded-lg">
            {messageDetailLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div 
                className="prose dark:prose-invert max-w-none text-sm"
                dangerouslySetInnerHTML={{ __html: messageDetail?.body || selectedMessage?.snippet || "" }}
              />
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setSelectedMessage(null)}>
              Close
            </Button>
            <Button onClick={() => {
              setComposeTo(selectedMessage?.from?.match(/<(.+)>/)?.[1] || selectedMessage?.from || "");
              setComposeSubject(`Re: ${selectedMessage?.subject || ""}`);
              setComposeBody("");
              setSelectedMessage(null);
              setShowCompose(true);
            }}>
              Reply
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCompose} onOpenChange={setShowCompose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Compose Email
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="email"
                placeholder="recipient@example.com"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                data-testid="input-compose-to"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                placeholder="Email subject"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                data-testid="input-compose-subject"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Message</Label>
              <Textarea
                id="body"
                placeholder="Write your message..."
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                className="min-h-[200px]"
                data-testid="input-compose-body"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompose(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSendEmail} 
              disabled={sendEmailMutation.isPending}
              data-testid="button-send-email"
            >
              {sendEmailMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
