declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}

declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export function getDocument(params: { data: Uint8Array }): {
    promise: Promise<{
      numPages: number;
      getPage(pageNumber: number): Promise<{
        getTextContent(): Promise<{
          items: Record<string, unknown>[];
        }>;
      }>;
      destroy(): void;
    }>;
  };
}

/* Allow setting pdfjsWorker on globalThis */
declare var pdfjsWorker: { WorkerMessageHandler: unknown };
