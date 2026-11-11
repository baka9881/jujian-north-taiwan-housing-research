import { createHash } from "node:crypto";

export function parseCsvTable(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/u, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV 引號未閉合，可能為截斷下載");
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }

  const [headers = [], ...values] = rows;
  return { headers, rows: values.filter((cells) => cells.some(Boolean)) };
}

export function parseCsv(text) {
  const { headers, rows } = parseCsvTable(text);
  return rows
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])))
    .filter((record) => !["TOWN", "The villages and towns urban district"].includes(record.鄉鎮市區));
}

export function normalizeName(value = "") {
  return value.replace(/[\s\-—–・．.（）()第期]/gu, "").toUpperCase();
}

export function normalizeIdentity(value = "") {
  return value.replace(/[\s\-—–・．.（）()]/gu, "").toUpperCase();
}

export function rocToIso(value = "") {
  const digits = value.replace(/\D/gu, "");
  if (digits.length < 7) return null;
  const year = Number(digits.slice(0, -4)) + 1911;
  if (digits.length !== 7) return null;
  const month = Number(digits.slice(-4, -2));
  const day = Number(digits.slice(-2));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${digits.slice(-4, -2)}-${digits.slice(-2)}`;
}

export function householdCount(value = "") {
  return Number(value.match(/\d+/u)?.[0] || 0);
}

export function cleanBuilder(value = "") {
  return value.split(/(?:（|\()?負責人|(?:（|\()?代表人/u, 1)[0].replace(/^[\s　（(,，;]+|[\s　（(,，;]+$/gu, "") || "未提供";
}

export function stableHash(value, length = 10) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function todayTaipei() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

export function seededPosition(name, region) {
  const digest = createHash("sha256").update(name).digest();
  return region === "林口"
    ? { mapX: 25 + digest[0] % 20, mapY: 31 + digest[1] % 38 }
    : { mapX: 57 + digest[0] % 19, mapY: 42 + digest[1] % 31 };
}

export async function fetchBytes(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "JujianNorthTaiwan/1.0 (+https://jujian-north-taiwan.baka0406.chatgpt.site)",
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

export function sourceKeyFor(project, region = project.region) {
  const registry = normalizeIdentity(project.registryNumber ?? project.編號);
  if (registry && registry !== normalizeIdentity("未提供")) return `${region}:registry:${registry}`;
  const permit = normalizeIdentity(project.permitNo ?? project.建造執照);
  if (permit && permit !== normalizeIdentity("未提供")) return `${region}:permit:${permit}`;
  const name = normalizeName(project.name ?? project.建案名稱);
  const land = normalizeIdentity(project.buildingLand ?? project.坐落基地);
  return `${region}:fallback:${name}:${land}`;
}
