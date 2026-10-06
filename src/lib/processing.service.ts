/**
 * Boundary for CPU/GPU-heavy document, OCR, AI, transcription and media work.
 * The core application depends only on this contract.
 */
export type ProcessingJobStatus =
  | "queued"
  | "processing"
  | "needs_review"
  | "completed"
  | "failed"
  | "not_implemented";

export type ProcessingImportItem = {
  item_type: "question" | "vocabulary" | "reading" | "listening" | "raw_text";
  page?: number | null;
  sheet?: string | null;
  payload: Record<string, unknown>;
  crop?: { x: number; y: number; width: number; height: number } | null;
  confidence?: number | null;
};

export type ProcessingJobRef = {
  jobId: string;
  status: ProcessingJobStatus;
  progress?: number;
  extractionMethod?: string | null;
  message?: string;
  error?: string | null;
  stats?: Record<string, unknown>;
  items?: ProcessingImportItem[];
  result?: Record<string, unknown>;
};

export interface ProcessingService {
  submitDocumentImport(input: {
    sourceFileId: string;
    sourceUrl: string;
    filename: string;
    mimeType?: string | null;
    profile?: Record<string, unknown> | null;
    mode?: "review" | "auto";
  }): Promise<ProcessingJobRef>;

  getImportStatus(jobId: string): Promise<ProcessingJobRef>;

  runOCR(input: {
    mediaId: string;
    languages?: string[];
  }): Promise<ProcessingJobRef>;

  extractQuestions(input: {
    sourceFileId: string;
    importJobId?: string;
  }): Promise<ProcessingJobRef>;

  extractVocabulary(input: {
    sourceFileId: string;
    importJobId?: string;
  }): Promise<ProcessingJobRef>;

  transcribeMedia(input: {
    mediaId: string;
    sourceUrl: string;
    filename: string;
    language?: string;
  }): Promise<ProcessingJobRef>;

  enrichVocabulary(input: {
    entryIds: string[];
    targetLanguages?: string[];
  }): Promise<ProcessingJobRef>;

  analyzeDuplicates(input: {
    questionIds: string[];
  }): Promise<ProcessingJobRef>;

  processMedia(input: {
    mediaId: string;
    operations: string[];
  }): Promise<ProcessingJobRef>;
}

const notImplemented = async (): Promise<ProcessingJobRef> => ({
  jobId: "",
  status: "not_implemented",
  message: "External processing service is not configured.",
});

export class PlaceholderProcessingService implements ProcessingService {
  submitDocumentImport = notImplemented;
  getImportStatus = notImplemented;
  runOCR = notImplemented;
  extractQuestions = notImplemented;
  extractVocabulary = notImplemented;

  async transcribeMedia(input: {
    mediaId: string;
    sourceUrl: string;
    filename: string;
    language?: string;
  }) {
    const result = await this.request<{
      job_id: string;
      status: ProcessingJobStatus;
    }>("/v1/jobs/transcription", {
      method: "POST",
      body: JSON.stringify({
        media_id: input.mediaId,
        source_url: input.sourceUrl,
        filename: input.filename,
        language: input.language ?? null,
      }),
    });

    return {
      jobId: result.job_id,
      status: result.status,
    };
  }

  enrichVocabulary = notImplemented;
  analyzeDuplicates = notImplemented;
  processMedia = notImplemented;
}

class HttpProcessingService implements ProcessingService {
  constructor(
    private readonly baseUrl: string,
    private readonly sharedSecret: string | null,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const headers = new Headers(init?.headers);
      headers.set("content-type", "application/json");
      if (this.sharedSecret) {
        headers.set("x-processing-key", this.sharedSecret);
      }

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Processing service error ${response.status}: ${body.slice(0, 1000)}`,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async submitDocumentImport(input: {
    sourceFileId: string;
    sourceUrl: string;
    filename: string;
    mimeType?: string | null;
    profile?: Record<string, unknown> | null;
    mode?: "review" | "auto";
  }) {
    const result = await this.request<{
      job_id: string;
      status: ProcessingJobStatus;
    }>("/v1/jobs/document-import", {
      method: "POST",
      body: JSON.stringify({
        source_file_id: input.sourceFileId,
        source_url: input.sourceUrl,
        filename: input.filename,
        mime_type: input.mimeType ?? null,
        mode: input.mode ?? "review",
        profile: input.profile ?? null,
      }),
    });

    return {
      jobId: result.job_id,
      status: result.status,
    };
  }

  async getImportStatus(jobId: string) {
    const result = await this.request<{
      job_id: string;
      status: ProcessingJobStatus;
      progress: number;
      extraction_method?: string | null;
      error?: string | null;
      stats?: Record<string, unknown>;
      items?: ProcessingImportItem[];
      result?: Record<string, unknown>;
    }>(`/v1/jobs/${encodeURIComponent(jobId)}`);

    return {
      jobId: result.job_id,
      status: result.status,
      progress: result.progress,
      extractionMethod: result.extraction_method ?? null,
      error: result.error ?? null,
      stats: result.stats ?? {},
      items: result.items ?? [],
      result: result.result ?? {},
    };
  }

  runOCR = notImplemented;
  extractQuestions = notImplemented;
  extractVocabulary = notImplemented;
  transcribeMedia = notImplemented;
  enrichVocabulary = notImplemented;
  analyzeDuplicates = notImplemented;
  processMedia = notImplemented;
}

export function getProcessingService(): ProcessingService {
  const rawUrl = process.env.PROCESSING_SERVICE_URL?.trim();
  if (!rawUrl) return new PlaceholderProcessingService();

  const baseUrl = rawUrl.replace(/\/+$/, "");
  return new HttpProcessingService(
    baseUrl,
    process.env.PROCESSING_SHARED_SECRET?.trim() || null,
  );
}
