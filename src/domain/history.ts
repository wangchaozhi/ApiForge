export type HistoryEntry = {
  id: string;
  requestId: string;
  requestName: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  elapsedMs: number;
  sizeBytes: number;
  requestJson: string;
  responseJson: string;
  createdAt: string;
};
