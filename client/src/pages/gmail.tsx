import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Library,
  Search,
  RefreshCw,
  Loader2,
  Folder,
  FileText,
  FileSpreadsheet,
  FileImage,
  File,
  ChevronRight,
  ArrowLeft,
  Download,
  ExternalLink,
  AlertCircle,
  HardDrive,
  Shield,
} from "lucide-react";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  webViewLink: string;
  iconLink: string;
  isFolder: boolean;
}

interface BreadcrumbItem {
  id: string | null; // null = Investment Library root
  name: string;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function getFileIcon(mimeType: string, isFolder: boolean) {
  if (isFolder) return <Folder className="h-5 w-5 text-blue-500" />;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv"))
    return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
  if (mimeType.includes("document") || mimeType.includes("word") || mimeType.includes("pdf") || mimeType.includes("text"))
    return <FileText className="h-5 w-5 text-red-500" />;
  if (mimeType.includes("image") || mimeType.includes("png") || mimeType.includes("jpeg"))
    return <FileImage className="h-5 w-5 text-purple-500" />;
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint"))
    return <FileText className="h-5 w-5 text-orange-500" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

export default function InvestmentLibraryPage() {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { id: null, name: "Investment Library" },
  ]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const {
    data: filesData,
    isLoading: filesLoading,
    error: filesError,
    refetch: refetchFiles,
  } = useQuery<{ files: DriveFile[] }>({
    queryKey: ["/api/drive/files", currentFolderId],
    queryFn: async () => {
      const params = currentFolderId ? `?folderId=${encodeURIComponent(currentFolderId)}` : "";
      const res = await fetch(`/api/drive/files${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to fetch files");
      }
      return res.json();
    },
  });

  const {
    data: searchData,
    isLoading: searchLoading,
    refetch: refetchSearch,
  } = useQuery<{ files: DriveFile[] }>({
    queryKey: ["/api/drive/search", searchQuery],
    queryFn: async () => {
      const res = await fetch(`/api/drive/search?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: false,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setIsSearching(true);
      refetchSearch();
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setIsSearching(false);
  };

  const navigateToFolder = (file: DriveFile) => {
    setCurrentFolderId(file.id);
    setBreadcrumbs((prev) => [...prev, { id: file.id, name: file.name }]);
    setIsSearching(false);
    setSearchQuery("");
  };

  const navigateToBreadcrumb = (index: number) => {
    const crumb = breadcrumbs[index];
    setCurrentFolderId(crumb.id);
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
    setIsSearching(false);
    setSearchQuery("");
  };

  const goBack = () => {
    if (breadcrumbs.length > 1) {
      navigateToBreadcrumb(breadcrumbs.length - 2);
    }
  };

  const displayFiles = isSearching ? searchData?.files || [] : filesData?.files || [];
  const loading = isSearching ? searchLoading : filesLoading;
  const folderCount = displayFiles.filter((f) => f.isFolder).length;
  const fileCount = displayFiles.filter((f) => !f.isFolder).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2" data-testid="text-investment-library-title">
            <Library className="h-8 w-8" />
            Investment Library
          </h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Read-only access to the Investment Library folder in Google Drive
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            if (isSearching) {
              clearSearch();
            }
            refetchFiles();
          }}
          disabled={loading}
          data-testid="button-refresh-files"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex gap-4 items-center">
        {breadcrumbs.length > 1 && !isSearching && (
          <Button variant="ghost" size="icon" onClick={goBack} data-testid="button-go-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <form onSubmit={handleSearch} className="flex gap-2 flex-1">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search files in Investment Library..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-files"
            />
          </div>
          <Button type="submit" disabled={searchLoading || !searchQuery.trim()} data-testid="button-search-files">
            {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
          </Button>
          {isSearching && (
            <Button variant="outline" onClick={clearSearch} data-testid="button-clear-search">
              Clear
            </Button>
          )}
        </form>
      </div>

      {!isSearching && (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <HardDrive className="h-3.5 w-3.5 mr-1" />
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              <button
                onClick={() => navigateToBreadcrumb(i)}
                className={`hover:text-foreground transition-colors ${
                  i === breadcrumbs.length - 1 ? "text-foreground font-medium" : ""
                }`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">
              {isSearching ? (
                <>
                  Search Results
                  <Badge variant="secondary" className="ml-2">
                    {displayFiles.length} found
                  </Badge>
                </>
              ) : (
                <>
                  {breadcrumbs[breadcrumbs.length - 1]?.name || "Investment Library"}
                  {!loading && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {folderCount > 0 && `${folderCount} folder${folderCount > 1 ? "s" : ""}`}
                      {folderCount > 0 && fileCount > 0 && ", "}
                      {fileCount > 0 && `${fileCount} file${fileCount > 1 ? "s" : ""}`}
                    </span>
                  )}
                </>
              )}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filesError ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 px-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <div className="text-center space-y-2 max-w-md">
                <p className="font-medium">Google Drive Connection Required</p>
                <p className="text-sm text-muted-foreground">
                  Unable to connect to Google Drive. This feature requires a Google OAuth connection
                  and an "Investment Library" folder in your Google Drive.
                </p>
                <p className="text-xs text-muted-foreground mt-3">
                  Ensure the Google connector is enabled in Replit and that a folder named
                  "Investment Library" exists in your Drive.
                </p>
              </div>
            </div>
          ) : loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : displayFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Folder className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">
                {isSearching ? "No files match your search" : "This folder is empty"}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {displayFiles.map((file) => (
                <div
                  key={file.id}
                  className={`flex items-center gap-4 p-4 hover-elevate ${
                    file.isFolder ? "cursor-pointer" : ""
                  }`}
                  onClick={() => file.isFolder && navigateToFolder(file)}
                  data-testid={`row-file-${file.id}`}
                >
                  <div className="shrink-0">{getFileIcon(file.mimeType, file.isFolder)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(file.modifiedTime)}
                      {!file.isFolder && ` \u00B7 ${formatFileSize(file.size)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!file.isFolder && (
                      <>
                        {file.webViewLink && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(file.webViewLink, "_blank", "noopener,noreferrer");
                            }}
                            title="Open in Google Drive"
                            data-testid={`button-open-drive-${file.id}`}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(`/api/drive/download/${file.id}`, "_blank");
                          }}
                          title="Download"
                          data-testid={`button-download-${file.id}`}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {file.isFolder && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
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
