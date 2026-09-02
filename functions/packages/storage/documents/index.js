import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const GROUP_FOLDERS = { "GRÚA": "grua", "CARROCERÍA": "carroceria" };
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
  if (storagePath.startsWith("carroceria/")) return "CARROCERÍA";
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
      downloadUrl,
    };
  }));
  return response(200, { documents });
}

async function prepareUpload(event, client, bucket) {
  const fileName = typeof event.fileName === "string" ? event.fileName.trim() : "";
  const group = event.group;
  if (!fileName || fileName.length > 220 || !/\.(xlsx|xls)$/i.test(fileName) || !GROUP_FOLDERS[group]) {
    return response(400, { error: "El nombre, formato o grupo del documento no es válido." });
  }
  const contentType = typeof event.contentType === "string" && event.contentType
    ? event.contentType
    : EXCEL_CONTENT_TYPE;
  const storagePath = `${GROUP_FOLDERS[group]}/${randomUUID()}--${encodedFileName(fileName)}`;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: storagePath, ContentType: contentType }),
    { expiresIn: 900 },
  );
  return response(200, { storagePath, uploadUrl });
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
    if (method === "POST" && event.action === "prepare-upload") return await prepareUpload(event, client, bucket);
    if (method === "POST" && event.action === "delete") return await deleteDocument(event, client, bucket);
    return response(405, { error: "Operación no permitida." });
  } catch (error) {
    console.error(error);
    return response(500, { error: "No se pudo comunicar con DigitalOcean Spaces." });
  }
}
