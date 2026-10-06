/**
 * Boundary for CPU/GPU-heavy document, OCR, AI, transcription and media work.
 *
 * The core TanStack application depends only on this contract. A later production
 * adapter may call an external Python/FastAPI service backed by Redis/workers and
 * S3-compatible object storage. Phase 1 intentionally ships a placeholder adapter
 * that reports unsupported work instead of fabricating results.
 */
export type ProcessingJobStatus =
  | "queued"
  | "processing"
  | "needs_review"
  | "completed"
  | "failed"
  | "not_implemented";

export type ProcessingJobRef = {
  jobId: string;
  status: ProcessingJobStatus;
  message?: string;
};

export interface ProcessingService {
  submitDocumentImport(input: {
    sourceFileId: string;
    profileId?: string | null;
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
  transcribeMedia = notImplemented;
  enrichVocabulary = notImplemented;
  analyzeDuplicates = notImplemented;
  processMedia = notImplemented;
}

/**
 * Server-side factory. Later this can choose HttpProcessingService when
 * PROCESSING_SERVICE_URL is configured.
 */
export function getProcessingService(): ProcessingService {
  return new PlaceholderProcessingService();
}
