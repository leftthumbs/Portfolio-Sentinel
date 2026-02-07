import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Upload, FileText, FileSpreadsheet, Trash2, FileEdit, 
  Sparkles, Loader2, AlertTriangle, Clock, CheckCircle2,
  Eye, Download, Cloud, FolderOpen, Import, Search, Folder,
  Plus, MoreHorizontal, Edit, FolderInput, FolderPlus
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type { DataRoomDocument, InvestmentMemo, MemoTemplateType } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FundFolder {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  color: string | null;
  icon: string | null;
  folderType: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface DataRoomResponse {
  documents: DataRoomDocument[];
}

interface MemosResponse {
  memos: InvestmentMemo[];
}

interface OneDriveFile {
  id: string;
  name: string;
  size: number;
  webUrl: string;
  lastModifiedDateTime: string;
  mimeType?: string;
  downloadUrl?: string;
}

interface OneDriveResponse {
  files: OneDriveFile[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getFileIcon(fileType: string) {
  if (fileType.includes("pdf")) return <FileText className="h-5 w-5 text-red-500" />;
  if (fileType.includes("spreadsheet") || fileType.includes("excel")) {
    return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
  }
  return <FileText className="h-5 w-5 text-blue-500" />;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "review":
      return <Badge variant="outline" className="border-yellow-500 text-yellow-500">In Review</Badge>;
    case "final":
      return <Badge variant="default" className="bg-green-600">Final</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

const TEMPLATE_OPTIONS: { value: MemoTemplateType; label: string; description: string }[] = [
  { value: "institutional", label: "Executive Summary", description: "Concise investment summary for IC review and monitoring" },
  { value: "everest_investment_summary", label: "Everest Investment Summary", description: "Everest Private Wealth detailed investment summary format" },
  { value: "verita_investment_memo", label: "Investment Memo", description: "Comprehensive investment memo with full due diligence sections" },
  { value: "investment_summary", label: "Investment Summary", description: "Standard investment summary with key terms, merits, risks, and track record" },
  { value: "verita_investment_summary", label: "Verita Investment Summary", description: "Verita format with manager summary, merits, risks, and track record" },
];

const FOLDER_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#6b7280"
];

export default function DataRoomPage() {
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedMemo, setSelectedMemo] = useState<InvestmentMemo | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DataRoomDocument | null>(null);
  const [oneDriveSearch, setOneDriveSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<MemoTemplateType>("institutional");
  const [memoSourceFolderId, setMemoSourceFolderId] = useState<string | null>(null);
  const [selectedDocFolderId, setSelectedDocFolderId] = useState<string | null>(null);
  const [selectedMemoFolderId, setSelectedMemoFolderId] = useState<string | null>(null);
  const [docFolderDialogOpen, setDocFolderDialogOpen] = useState(false);
  const [memoFolderDialogOpen, setMemoFolderDialogOpen] = useState(false);
  const [editingDocFolder, setEditingDocFolder] = useState<FundFolder | null>(null);
  const [editingMemoFolder, setEditingMemoFolder] = useState<FundFolder | null>(null);

  const { data: docsData, isLoading: docsLoading } = useQuery<DataRoomResponse>({
    queryKey: ["/api/data-room"],
  });

  const { data: memosData, isLoading: memosLoading } = useQuery<MemosResponse>({
    queryKey: ["/api/memos"],
  });

  const { data: oneDriveData, isLoading: oneDriveLoading, error: oneDriveError } = useQuery<OneDriveResponse>({
    queryKey: ["/api/onedrive/files"],
    retry: false,
  });

  const { data: docFoldersData } = useQuery<{ folders: FundFolder[] }>({
    queryKey: ["/api/folders?type=document"],
  });

  const { data: memoFoldersData } = useQuery<{ folders: FundFolder[] }>({
    queryKey: ["/api/folders?type=memo"],
  });

  const docFolders = docFoldersData?.folders || [];
  const memoFolders = memoFoldersData?.folders || [];

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/data-room/upload", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to upload file");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/data-room"] });
      toast({
        title: "Document uploaded",
        description: "The document has been analyzed and added to the data room.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/data-room/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/data-room"] });
      toast({ title: "Document deleted" });
    },
  });

  const generateMemoMutation = useMutation({
    mutationFn: async ({ templateType, folderId }: { templateType: MemoTemplateType; folderId: string | null }) => {
      return apiRequest("POST", "/api/memos/generate", { templateType, folderId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/memos"] });
      toast({
        title: "Memo generated",
        description: "A new investment memo has been created based on the data room materials.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Generation failed",
        description: error.message,
      });
    },
  });

  const deleteMemoMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/memos/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/memos"] });
      toast({ title: "Memo deleted" });
    },
  });

  const importFromOneDriveMutation = useMutation({
    mutationFn: async (file: OneDriveFile) => {
      return apiRequest("POST", `/api/onedrive/import/${file.id}`, {
        fileName: file.name,
        mimeType: file.mimeType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/data-room"] });
      toast({
        title: "File imported",
        description: "The OneDrive file has been imported and analyzed.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: error.message,
      });
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async ({ name, color, folderType }: { name: string; color: string | null; folderType: string }) => {
      return apiRequest("POST", "/api/folders", { name, color, folderType });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/folders?type=${variables.folderType}`] });
      toast({ title: "Folder created" });
    },
  });

  const updateFolderMutation = useMutation({
    mutationFn: async ({ id, name, color, folderType }: { id: string; name: string; color: string | null; folderType: string }) => {
      return apiRequest("PATCH", `/api/folders/${id}`, { name, color });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/folders?type=${variables.folderType}`] });
      toast({ title: "Folder updated" });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async ({ id, folderType }: { id: string; folderType: string }) => {
      return apiRequest("DELETE", `/api/folders/${id}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/folders?type=${variables.folderType}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/data-room"] });
      queryClient.invalidateQueries({ queryKey: ["/api/memos"] });
      toast({ title: "Folder deleted" });
    },
  });

  const moveDocumentToFolderMutation = useMutation({
    mutationFn: async ({ documentId, folderId }: { documentId: string; folderId: string | null }) => {
      return apiRequest("PATCH", `/api/data-room/documents/${documentId}/folder`, { folderId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/data-room"] });
      toast({ title: "Document moved" });
    },
  });

  const moveMemoToFolderMutation = useMutation({
    mutationFn: async ({ memoId, folderId }: { memoId: string; folderId: string | null }) => {
      return apiRequest("PATCH", `/api/memos/${memoId}/folder`, { folderId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/memos"] });
      toast({ title: "Memo moved" });
    },
  });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => uploadMutation.mutate(file));
  }, [uploadMutation]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => uploadMutation.mutate(file));
  }, [uploadMutation]);

  const allDocuments = docsData?.documents || [];
  const allMemos = memosData?.memos || [];

  const documents = allDocuments.filter((doc: any) => {
    if (selectedDocFolderId === null) return true;
    if (selectedDocFolderId === "unfiled") return !doc.folderId;
    return doc.folderId === selectedDocFolderId;
  });

  const memos = allMemos.filter((memo: any) => {
    if (selectedMemoFolderId === null) return true;
    if (selectedMemoFolderId === "unfiled") return !memo.folderId;
    return memo.folderId === selectedMemoFolderId;
  });

  const getDocFolderCounts = () => {
    const counts: Record<string, number> = { all: allDocuments.length, unfiled: 0 };
    allDocuments.forEach((doc: any) => {
      if (!doc.folderId) counts.unfiled++;
      else counts[doc.folderId] = (counts[doc.folderId] || 0) + 1;
    });
    return counts;
  };

  const getMemoFolderCounts = () => {
    const counts: Record<string, number> = { all: allMemos.length, unfiled: 0 };
    allMemos.forEach((memo: any) => {
      if (!memo.folderId) counts.unfiled++;
      else counts[memo.folderId] = (counts[memo.folderId] || 0) + 1;
    });
    return counts;
  };

  const docFolderCounts = getDocFolderCounts();
  const memoFolderCounts = getMemoFolderCounts();

  const filteredDocs = selectedDocFolderId === null 
    ? documents 
    : selectedDocFolderId === "unfiled" 
      ? documents.filter(d => !(d as any).folderId) 
      : documents.filter(d => (d as any).folderId === selectedDocFolderId);

  const filteredMemos = selectedMemoFolderId === null 
    ? memos 
    : selectedMemoFolderId === "unfiled" 
      ? memos.filter(m => !(m as any).folderId) 
      : memos.filter(m => (m as any).folderId === selectedMemoFolderId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Data Room & Memos</h1>
          <p className="text-muted-foreground mt-1">
            Upload data room materials and generate AI-powered investment memos
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select 
            value={selectedTemplate} 
            onValueChange={(value: MemoTemplateType) => setSelectedTemplate(value)}
          >
            <SelectTrigger className="w-[220px]" data-testid="select-template">
              <SelectValue placeholder="Select template" />
            </SelectTrigger>
            <SelectContent>
              {TEMPLATE_OPTIONS.map((template) => (
                <SelectItem 
                  key={template.value} 
                  value={template.value}
                  data-testid={`option-template-${template.value}`}
                >
                  {template.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select 
            value={memoSourceFolderId || "all"} 
            onValueChange={(value) => setMemoSourceFolderId(value === "all" ? null : value)}
          >
            <SelectTrigger className="w-[180px]" data-testid="select-source-folder">
              <FolderOpen className="h-4 w-4 mr-2 shrink-0" />
              <SelectValue placeholder="Source folder" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" data-testid="source-folder-all">
                All Documents
              </SelectItem>
              {docFolders.map((folder) => (
                <SelectItem 
                  key={folder.id} 
                  value={folder.id}
                  data-testid={`source-folder-${folder.id}`}
                >
                  <div className="flex items-center gap-2">
                    {folder.color && (
                      <div 
                        className="w-2 h-2 rounded-full shrink-0" 
                        style={{ backgroundColor: folder.color }} 
                      />
                    )}
                    {folder.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => generateMemoMutation.mutate({ templateType: selectedTemplate, folderId: memoSourceFolderId })}
            disabled={generateMemoMutation.isPending || documents.length === 0}
            data-testid="button-generate-memo"
          >
            {generateMemoMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Memo
              </>
            )}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="documents" className="space-y-4">
        <TabsList>
          <TabsTrigger value="documents" data-testid="tab-documents">
            Data Room ({documents.length})
          </TabsTrigger>
          <TabsTrigger value="onedrive" data-testid="tab-onedrive">
            <Cloud className="h-4 w-4 mr-1" />
            OneDrive
          </TabsTrigger>
          <TabsTrigger value="memos" data-testid="tab-memos">
            Investment Memos ({memos.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="space-y-4">
          <div className="flex gap-4">
            {/* Document Folder Panel */}
            <div className="w-56 shrink-0 space-y-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Folders</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDocFolderDialogOpen(true)}
                  data-testid="button-create-doc-folder"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant={selectedDocFolderId === null ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => setSelectedDocFolderId(null)}
                data-testid="doc-folder-all"
              >
                <FolderOpen className="h-4 w-4" />
                All Documents
                <Badge variant="outline" className="ml-auto">{docFolderCounts.all}</Badge>
              </Button>
              <Button
                variant={selectedDocFolderId === "unfiled" ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => setSelectedDocFolderId("unfiled")}
                data-testid="doc-folder-unfiled"
              >
                <Folder className="h-4 w-4" />
                Unfiled
                <Badge variant="outline" className="ml-auto">{docFolderCounts.unfiled}</Badge>
              </Button>
              {docFolders.map((folder) => (
                <div key={folder.id} className="group relative">
                  <Button
                    variant={selectedDocFolderId === folder.id ? "secondary" : "ghost"}
                    className="w-full justify-start gap-2 pr-8"
                    onClick={() => setSelectedDocFolderId(folder.id)}
                    data-testid={`doc-folder-${folder.id}`}
                  >
                    <Folder className="h-4 w-4" style={{ color: folder.color || undefined }} />
                    <span className="truncate">{folder.name}</span>
                    <Badge variant="outline" className="ml-auto">{docFolderCounts[folder.id] || 0}</Badge>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100"
                        data-testid={`doc-folder-menu-${folder.id}`}
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => { setEditingDocFolder(folder); setDocFolderDialogOpen(true); }}>
                        <Edit className="h-4 w-4 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("Delete this folder? Documents will be moved to Unfiled.")) {
                            deleteFolderMutation.mutate({ id: folder.id, folderType: "document" });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
            {/* Documents Content */}
            <div className="flex-1 space-y-4">
              <Card data-testid="card-upload-zone">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Documents
              </CardTitle>
              <CardDescription>
                Upload fund fact sheets, quarterly reports, due diligence materials, and other investment documents
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-primary/50"
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                data-testid="dropzone-documents"
              >
                {uploadMutation.isPending ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-10 w-10 text-primary animate-spin" />
                    <p className="text-sm font-medium">Uploading and analyzing...</p>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-center gap-3 mb-3">
                      <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
                      <FileText className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium mb-1">
                      Drag and drop files here
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      PDF, Excel, or CSV files
                    </p>
                    <Input
                      type="file"
                      accept=".pdf,.xlsx,.xls,.csv"
                      multiple
                      className="hidden"
                      id="doc-upload"
                      onChange={handleFileSelect}
                      data-testid="input-doc-upload"
                    />
                    <label htmlFor="doc-upload">
                      <Button variant="outline" size="sm" asChild>
                        <span data-testid="button-browse-docs">Browse Files</span>
                      </Button>
                    </label>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-documents-list">
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <CardDescription>
                {documents.length} documents in data room
              </CardDescription>
            </CardHeader>
            <CardContent>
              {documents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <FileText className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">No documents uploaded yet</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Document</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Uploaded</TableHead>
                        <TableHead className="w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredDocs.map((doc) => (
                        <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getFileIcon(doc.fileType)}
                              <span className="font-medium">{doc.fileName}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{doc.documentType || "Unknown"}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatBytes(doc.fileSize)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(doc.uploadedAt)}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setSelectedDoc(doc)}
                                data-testid={`button-view-doc-${doc.id}`}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" data-testid={`button-move-doc-${doc.id}`}>
                                    <FolderPlus className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => moveDocumentToFolderMutation.mutate({ documentId: doc.id, folderId: null })}>
                                    <Folder className="h-4 w-4 mr-2" />
                                    Unfiled
                                  </DropdownMenuItem>
                                  {docFolders.map((folder) => (
                                    <DropdownMenuItem
                                      key={folder.id}
                                      onClick={() => moveDocumentToFolderMutation.mutate({ documentId: doc.id, folderId: folder.id.toString() })}
                                    >
                                      <Folder className="h-4 w-4 mr-2" style={{ color: folder.color || undefined }} />
                                      {folder.name}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteMutation.mutate(doc.id)}
                                data-testid={`button-delete-doc-${doc.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="onedrive" className="space-y-4">
          <Card data-testid="card-onedrive">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="h-5 w-5" />
                OneDrive Files
              </CardTitle>
              <CardDescription>
                Browse and import files from your connected Microsoft OneDrive
              </CardDescription>
            </CardHeader>
            <CardContent>
              {oneDriveLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : oneDriveError ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <Cloud className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">OneDrive not connected</p>
                  <p className="text-sm text-muted-foreground">
                    Please connect your Microsoft account to access OneDrive files
                  </p>
                </div>
              ) : (oneDriveData?.files?.length || 0) === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <FolderOpen className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">No files found in OneDrive</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File Name</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Modified</TableHead>
                        <TableHead className="w-[120px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {oneDriveData?.files?.map((file) => (
                        <TableRow key={file.id} data-testid={`row-onedrive-${file.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getFileIcon(file.mimeType || file.name)}
                              <span className="font-medium">{file.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatBytes(file.size)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(file.lastModifiedDateTime)}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => importFromOneDriveMutation.mutate(file)}
                                disabled={importFromOneDriveMutation.isPending}
                                data-testid={`button-import-onedrive-${file.id}`}
                              >
                                {importFromOneDriveMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Import className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => window.open(file.webUrl, '_blank')}
                                data-testid={`button-open-onedrive-${file.id}`}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="memos" className="space-y-4">
          <div className="flex gap-4">
            {/* Memo Folder Panel */}
            <div className="w-56 shrink-0 space-y-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Folders</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMemoFolderDialogOpen(true)}
                  data-testid="button-create-memo-folder"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant={selectedMemoFolderId === null ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => setSelectedMemoFolderId(null)}
                data-testid="memo-folder-all"
              >
                <FolderOpen className="h-4 w-4" />
                All Memos
                <Badge variant="outline" className="ml-auto">{memoFolderCounts.all}</Badge>
              </Button>
              <Button
                variant={selectedMemoFolderId === "unfiled" ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => setSelectedMemoFolderId("unfiled")}
                data-testid="memo-folder-unfiled"
              >
                <Folder className="h-4 w-4" />
                Unfiled
                <Badge variant="outline" className="ml-auto">{memoFolderCounts.unfiled}</Badge>
              </Button>
              {memoFolders.map((folder) => (
                <div key={folder.id} className="group relative">
                  <Button
                    variant={selectedMemoFolderId === folder.id ? "secondary" : "ghost"}
                    className="w-full justify-start gap-2 pr-8"
                    onClick={() => setSelectedMemoFolderId(folder.id)}
                    data-testid={`memo-folder-${folder.id}`}
                  >
                    <Folder className="h-4 w-4" style={{ color: folder.color || undefined }} />
                    <span className="truncate">{folder.name}</span>
                    <Badge variant="outline" className="ml-auto">{memoFolderCounts[folder.id] || 0}</Badge>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100"
                        data-testid={`memo-folder-menu-${folder.id}`}
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => { setEditingMemoFolder(folder); setMemoFolderDialogOpen(true); }}>
                        <Edit className="h-4 w-4 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("Delete this folder? Memos will be moved to Unfiled.")) {
                            deleteFolderMutation.mutate({ id: folder.id, folderType: "memo" });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
            {/* Memos Content */}
            <div className="flex-1">
              <Card data-testid="card-memos-list">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileEdit className="h-5 w-5" />
                Investment Memos
              </CardTitle>
              <CardDescription>
                AI-generated investment memos based on data room materials
              </CardDescription>
            </CardHeader>
            <CardContent>
              {memos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <Sparkles className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">No memos generated yet</p>
                  <p className="text-sm text-muted-foreground">
                    Upload documents to the data room, then click "Generate Investment Memo"
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredMemos.map((memo) => (
                    <div
                      key={memo.id}
                      className="flex items-center justify-between p-4 rounded-lg border hover-elevate cursor-pointer"
                      onClick={() => setSelectedMemo(memo)}
                      data-testid={`card-memo-${memo.id}`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium">{memo.title}</h3>
                          {getStatusBadge(memo.status)}
                          {memo.autoGenerated && (
                            <Badge variant="outline" className="text-xs">
                              <Sparkles className="h-3 w-3 mr-1" />
                              AI Generated
                            </Badge>
                          )}
                          {(memo as any).templateType && (
                            <Badge variant="secondary" className="text-xs">
                              {(memo as any).templateType === "everest_investment_summary" 
                                ? "Everest" 
                                : (memo as any).templateType === "verita_investment_memo" 
                                ? "Investment Memo" 
                                : (memo as any).templateType === "investment_summary"
                                ? "Investment Summary"
                                : (memo as any).templateType === "verita_investment_summary"
                                ? "Verita"
                                : "Executive"}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(memo.createdAt)}
                          </span>
                          {memo.generatedFromDocuments && (
                            <span>{memo.generatedFromDocuments.length} source documents</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(`/api/memos/${memo.id}/download`, '_blank');
                          }}
                          data-testid={`button-download-memo-${memo.id}`}
                          title="Download as Word document"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" data-testid={`button-move-memo-${memo.id}`}>
                              <FolderPlus className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem onClick={() => moveMemoToFolderMutation.mutate({ memoId: memo.id.toString(), folderId: null })}>
                              <Folder className="h-4 w-4 mr-2" />
                              Unfiled
                            </DropdownMenuItem>
                            {memoFolders.map((folder) => (
                              <DropdownMenuItem
                                key={folder.id}
                                onClick={() => moveMemoToFolderMutation.mutate({ memoId: memo.id.toString(), folderId: folder.id.toString() })}
                              >
                                <Folder className="h-4 w-4 mr-2" style={{ color: folder.color || undefined }} />
                                {folder.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMemoMutation.mutate(memo.id);
                          }}
                          data-testid={`button-delete-memo-${memo.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Document Folder Dialog */}
      <Dialog open={docFolderDialogOpen} onOpenChange={(open) => { setDocFolderDialogOpen(open); if (!open) setEditingDocFolder(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingDocFolder ? "Rename Folder" : "Create Folder"}</DialogTitle>
            <DialogDescription>
              {editingDocFolder ? "Update the folder name and color." : "Create a new folder to organize your documents."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="doc-folder-name">Folder Name</Label>
              <Input
                id="doc-folder-name"
                defaultValue={editingDocFolder?.name || ""}
                placeholder="Enter folder name"
                data-testid="input-doc-folder-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Color (optional)</Label>
              <div className="flex gap-2 flex-wrap">
                {FOLDER_COLORS.map((color) => (
                  <button
                    key={color}
                    className="h-6 w-6 rounded-full border-2 border-transparent hover:border-foreground/50"
                    style={{ backgroundColor: color }}
                    data-testid={`doc-folder-color-${color}`}
                    onClick={() => {
                      const input = document.getElementById("doc-folder-name") as HTMLInputElement;
                      const name = input?.value;
                      if (!name) return;
                      if (editingDocFolder) {
                        updateFolderMutation.mutate({ id: editingDocFolder.id, name, color, folderType: "document" });
                      } else {
                        createFolderMutation.mutate({ name, color, folderType: "document" });
                      }
                      setDocFolderDialogOpen(false);
                      setEditingDocFolder(null);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDocFolderDialogOpen(false); setEditingDocFolder(null); }} data-testid="button-cancel-doc-folder">
              Cancel
            </Button>
            <Button
              onClick={() => {
                const input = document.getElementById("doc-folder-name") as HTMLInputElement;
                const name = input?.value;
                if (!name) return;
                if (editingDocFolder) {
                  updateFolderMutation.mutate({ id: editingDocFolder.id, name, color: editingDocFolder.color, folderType: "document" });
                } else {
                  createFolderMutation.mutate({ name, color: null, folderType: "document" });
                }
                setDocFolderDialogOpen(false);
                setEditingDocFolder(null);
              }}
              data-testid="button-save-doc-folder"
            >
              {editingDocFolder ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Memo Folder Dialog */}
      <Dialog open={memoFolderDialogOpen} onOpenChange={(open) => { setMemoFolderDialogOpen(open); if (!open) setEditingMemoFolder(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingMemoFolder ? "Rename Folder" : "Create Folder"}</DialogTitle>
            <DialogDescription>
              {editingMemoFolder ? "Update the folder name and color." : "Create a new folder to organize your memos."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="memo-folder-name">Folder Name</Label>
              <Input
                id="memo-folder-name"
                defaultValue={editingMemoFolder?.name || ""}
                placeholder="Enter folder name"
                data-testid="input-memo-folder-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Color (optional)</Label>
              <div className="flex gap-2 flex-wrap">
                {FOLDER_COLORS.map((color) => (
                  <button
                    key={color}
                    className="h-6 w-6 rounded-full border-2 border-transparent hover:border-foreground/50"
                    style={{ backgroundColor: color }}
                    data-testid={`memo-folder-color-${color}`}
                    onClick={() => {
                      const input = document.getElementById("memo-folder-name") as HTMLInputElement;
                      const name = input?.value;
                      if (!name) return;
                      if (editingMemoFolder) {
                        updateFolderMutation.mutate({ id: editingMemoFolder.id, name, color, folderType: "memo" });
                      } else {
                        createFolderMutation.mutate({ name, color, folderType: "memo" });
                      }
                      setMemoFolderDialogOpen(false);
                      setEditingMemoFolder(null);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMemoFolderDialogOpen(false); setEditingMemoFolder(null); }} data-testid="button-cancel-memo-folder">
              Cancel
            </Button>
            <Button
              onClick={() => {
                const input = document.getElementById("memo-folder-name") as HTMLInputElement;
                const name = input?.value;
                if (!name) return;
                if (editingMemoFolder) {
                  updateFolderMutation.mutate({ id: editingMemoFolder.id, name, color: editingMemoFolder.color, folderType: "memo" });
                } else {
                  createFolderMutation.mutate({ name, color: null, folderType: "memo" });
                }
                setMemoFolderDialogOpen(false);
                setEditingMemoFolder(null);
              }}
              data-testid="button-save-memo-folder"
            >
              {editingMemoFolder ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedMemo} onOpenChange={() => setSelectedMemo(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedMemo?.title}</DialogTitle>
            <DialogDescription>
              Generated {formatDate(selectedMemo?.createdAt)}
            </DialogDescription>
          </DialogHeader>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <div className="whitespace-pre-wrap font-mono text-sm bg-muted p-4 rounded-lg">
              {selectedMemo?.content}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedDoc} onOpenChange={() => setSelectedDoc(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedDoc && getFileIcon(selectedDoc.fileType)}
              {selectedDoc?.fileName}
            </DialogTitle>
            <DialogDescription>
              {selectedDoc?.documentType} • {selectedDoc && formatBytes(selectedDoc.fileSize)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-2">AI Analysis</h4>
              <div className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted p-4 rounded-lg">
                {selectedDoc?.extractedContent || "No analysis available"}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
