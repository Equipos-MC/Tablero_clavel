import { requestJson } from "./request";
export type WorkOrder = { id: string; name: string; tabs: string[] };

export type StoredDocument = {
  id: string;
  fileName: string;
  group: string;
  orderId: string;
  storagePath: string;
  downloadUrl: string;
};

type UploadTicket = {
  storagePath: string;
  uploadUrl: string;
};

const apiUrl = import.meta.env.VITE_DOCUMENTS_API_URL || "/api/storage/documents";

function apiRequest<T>(options?: RequestInit, retryRead = !options?.method || options.method === "GET"): Promise<T> {
  return requestJson<T>(apiUrl, options, retryRead);
}

export const listStoredDocuments = () => apiRequest<{ documents: StoredDocument[]; orders: WorkOrder[] }>();

export const prepareDocumentUpload = (fileName: string, group: StoredDocument["group"], contentType: string, orderId: string) =>
  apiRequest<UploadTicket>({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prepare-upload", fileName, group, contentType, orderId }),
  });

export async function uploadToSpace(uploadUrl: string, file: File) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    body: file,
  });
  if (!response.ok) throw new Error("DigitalOcean Spaces rechazó la carga del archivo.");
}

export const deleteStoredDocument = (storagePath: string) =>
  apiRequest<{ deleted: boolean }>({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", storagePath }),
  });

export const saveWorkOrder = (data: { action: "create-order"; name: string; tabs: string[] } | { action: "add-tab"; orderId: string; tab: string }) =>
  apiRequest<{ order: WorkOrder }>({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

export const getTabImage = (orderId: string, group: string) =>
  apiRequest<{ downloadUrl: string | null }>({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get-tab-image", orderId, group }) }, true);

export const prepareTabImage = (orderId: string, group: string, file: File) =>
  apiRequest<UploadTicket>({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare-tab-image", orderId, group, contentType: file.type, size: file.size }) });
