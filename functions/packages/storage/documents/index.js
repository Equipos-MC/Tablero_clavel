import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DEFAULT_ORDER = { id: "legacy-eh150", name: "OT-EH-150", tabs: ["GRÚA", "CHASIS"] };
const normalize = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const validLabel = (value) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 100;
async function listOrders(client, bucket, objects) {
  const records = await Promise.all(objects.filter((item) => /^orders\/[^/]+\.json$/.test(item.Key || "")).map(async (item) => {
    const data = await client.send(new GetObjectCommand({ Bucket: bucket, Key: item.Key }));
    return JSON.parse(await data.Body.transformToString());
  }));
  const orders = [{ ...DEFAULT_ORDER, tabs: [...DEFAULT_ORDER.tabs] }, ...records];
  for (const order of orders) {
    const prefix = "tabs/" + order.id + "/";
    for (const item of objects.filter((item) => item.Key?.startsWith(prefix))) {
      const tab = Buffer.from(item.Key.slice(prefix.length), "base64url").toString("utf8");
      if (!order.tabs.some((name) => normalize(name) === normalize(tab))) order.tabs.push(tab);
    }
  }
  return orders;
}
async function saveOrder(event, client, bucket) {
  const orders = await listOrders(client, bucket, await listAllObjects(client, bucket));
  let key, record;
  if (event.action === "create-order") {
    if (!validLabel(event.name) || !Array.isArray(event.tabs) || !event.tabs.length || !event.tabs.every(validLabel)) return response(400, { error: "Escribe el nombre de la OT y al menos una pestaña (máximo 100 caracteres por nombre)." });
    const name = event.name.trim().toUpperCase();
    const tabs = event.tabs.map((tab) => tab.trim().toUpperCase());
    if (new Set(tabs.map(normalize)).size !== tabs.length) return response(400, { error: "No repitas nombres de pestañas." });
    if (orders.some((order) => normalize(order.name) === normalize(name))) return response(409, { error: "Ya existe una OT con ese nombre." });
    record = { id: Buffer.from(normalize(name)).toString("base64url"), name, tabs };
    key = "orders/" + record.id + ".json";
  } else {
    const order = orders.find((item) => item.id === event.orderId);
    if (!order || !validLabel(event.tab)) return response(400, { error: "La OT o la pestaña no es válida." });
    const tab = event.tab.trim().toUpperCase();
    if (order.tabs.some((name) => normalize(name) === normalize(tab))) return response(409, { error: "Esta pestaña ya existe." });
    key = "tabs/" + order.id + "/" + Buffer.from(tab).toString("base64url");
    record = { ...order, tabs: [...order.tabs, tab] };
  }
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(record), ContentType: "application/json" }));
  return response(200, { order: record });
}
const EXCEL_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function configuration() {
  const region = process.env.SPACES_REGION;
  const bucket = process.env.SPACES_BUCKET;
  const accessKeyId = process.env.SPACES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SPACES_SECRET_ACCESS_KEY;
  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Falta configurar DigitalOcean Spaces.");
  }
  return {
    bucket,
    client: new S3Client({
      endpoint: `https://${region}.digitaloceanspaces.com`,
      forcePathStyle: false,
      region: "us-east-1",
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": process.env.APP_ORIGIN || "*",
      "Cache-Control": "no-store",
    },
    body,
  };
}

function encodedFileName(fileName) {
  return Buffer.from(fileName, "utf8").toString("base64url");
}

function decodedFileName(storagePath) {
  const objectName = storagePath.split("/").pop() || storagePath;
  const encoded = objectName.match(/^[0-9a-f-]{36}--(.+)$/i)?.[1];
  if (!encoded) return objectName;
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return objectName;
  }
}

function groupForPath(storagePath) {
  if (storagePath.startsWith("grua/")) return "GRÚA";
  if (storagePath.startsWith("carroceria/")) return "CHASIS";
  const match = storagePath.match(/^documents\/[^/]+\/([^/]+)\/[^/]+$/);
  if (match) return Buffer.from(match[1], "base64url").toString("utf8");
  return undefined;
}

function validStoragePath(storagePath) {
  return typeof storagePath === "string" && Boolean(groupForPath(storagePath)) && !storagePath.includes("..");
}

async function listAllObjects(client, bucket) {
  const objects = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }));
    objects.push(...(page.Contents || []));
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  return objects;
}

async function listDocuments(client, bucket) {
  const objects = await listAllObjects(client, bucket);
  const eligible = objects
    .filter((object) => object.Key && groupForPath(object.Key) && /\.(xlsx|xls)$/i.test(decodedFileName(object.Key)))
    .sort((left, right) => (left.LastModified?.getTime() || 0) - (right.LastModified?.getTime() || 0));

  const documents = await Promise.all(eligible.map(async (object) => {
    const storagePath = object.Key;
    const downloadUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: storagePath }),
      { expiresIn: 900 },
    );
    return {
      id: storagePath,
      storagePath,
      fileName: decodedFileName(storagePath),
      group: groupForPath(storagePath),
      orderId: storagePath.startsWith("documents/") ? storagePath.split("/")[1] : DEFAULT_ORDER.id,
      downloadUrl,
    };
  }));
  return response(200, { documents, orders: await listOrders(client, bucket, objects) });
}

async function prepareUpload(event, client, bucket) {
  const fileName = typeof event.fileName === "string" ? event.fileName.trim() : "";
  const group = event.group;
  if (!fileName || fileName.length > 220 || !/\.(xlsx|xls)$/i.test(fileName) || !validLabel(group)) {
    return response(400, { error: "El nombre, formato o grupo del documento no es válido." });
  }
  const contentType = typeof event.contentType === "string" && event.contentType
    ? event.contentType
    : EXCEL_CONTENT_TYPE;
  const orders = await listOrders(client, bucket, await listAllObjects(client, bucket));
  const order = orders.find((item) => item.id === (event.orderId || DEFAULT_ORDER.id));
  const tab = !event.orderId && group === "CARROCERÍA" ? "CHASIS" : group;
  if (!order || !order.tabs.includes(tab)) return response(400, { error: "La OT o pestaña no existe." });
  const storagePath = "documents/" + order.id + "/" + Buffer.from(tab).toString("base64url") + "/" + randomUUID() + "--" + encodedFileName(fileName);
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: storagePath, ContentType: contentType }),
    { expiresIn: 900 },
  );
  return response(200, { storagePath, uploadUrl });
}


async function tabImage(event, client, bucket) {
  const objects = await listAllObjects(client, bucket);
  const orders = await listOrders(client, bucket, objects);
  const order = orders.find((item) => item.id === event.orderId);
  if (!order || !order.tabs.includes(event.group)) return response(400, { error: "La OT o pestaña no existe." });
  const storagePath = "tab-images/" + order.id + "/" + Buffer.from(event.group).toString("base64url");
  if (event.action === "prepare-tab-image") {
    if (!["image/jpeg", "image/png", "image/webp"].includes(event.contentType) || !Number.isInteger(event.size) || event.size <= 0 || event.size > 10 * 1024 * 1024) {
      return response(400, { error: "Selecciona una imagen JPG, PNG o WebP de hasta 10 MB." });
    }
    const uploadUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: storagePath, ContentType: event.contentType }), { expiresIn: 900 });
    return response(200, { storagePath, uploadUrl });
  }
  if (!objects.some((item) => item.Key === storagePath)) return response(200, { downloadUrl: null });
  const downloadUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: storagePath, ResponseCacheControl: "no-store" }), { expiresIn: 900 });
  return response(200, { downloadUrl });
}

async function deleteDocument(event, client, bucket) {
  if (!validStoragePath(event.storagePath)) {
    return response(400, { error: "La ruta del documento no es válida." });
  }
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: event.storagePath }));
  return response(200, { deleted: true });
}

export async function main(event = {}) {
  try {
    const { client, bucket } = configuration();
    const method = event.http?.method || "GET";
    if (method === "GET") return await listDocuments(client, bucket);
    if (method === "POST" && ["get-tab-image", "prepare-tab-image"].includes(event.action)) return await tabImage(event, client, bucket);
    if (method === "POST" && ["create-order", "add-tab"].includes(event.action)) return await saveOrder(event, client, bucket);
    if (method === "POST" && event.action === "prepare-upload") return await prepareUpload(event, client, bucket);
    if (method === "POST" && event.action === "delete") return await deleteDocument(event, client, bucket);
    return response(405, { error: "Operación no permitida." });
  } catch (error) {
    console.error(error);
    return response(500, { error: "No se pudo comunicar con DigitalOcean Spaces." });
  }
}
