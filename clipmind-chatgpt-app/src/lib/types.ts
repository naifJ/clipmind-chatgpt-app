export type FileReference = {
  file_id?: string;
  download_url?: string;
  file_name?: string;
  mime_type?: string;
};

export type OutputFileReference = {
  file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  download_url: string;
};

export type OperationStatus = "ready" | "processing" | "completed" | "error";

export type WidgetOperationResult = {
  operation: string;
  status: OperationStatus;
  summary_ar: string;
  summary_en: string;
  files: OutputFileReference[];
  details?: Record<string, unknown>;
};
