import { parseCsvTable, rocToIso } from "./data-utils.mjs";

const expectedTailFields = ["坐落基地", "建照核發日期", "建造執照", "第1次登記日期", "編號"];

function cellsToRecord(headers, cells) {
  return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
}

function parenthesisBalance(value) {
  return [...value].reduce((balance, character) => balance + ("(（".includes(character) ? 1 : ")）".includes(character) ? -1 : 0), 0);
}

export function repairBuildcaseCells(headers, cells) {
  if (cells.length <= headers.length) return cellsToRecord(headers, cells);
  if (headers.length !== 15 || expectedTailFields.some((field, index) => headers[headers.length - 5 + index] !== field)) {
    throw new Error(`建案 CSV 欄位數 ${cells.length} 超過表頭 ${headers.length}，且不是可辨識的官方格式`);
  }

  const leading = cells.slice(0, 5);
  const tail = cells.slice(-5);
  const middle = cells.slice(5, -5);
  const declaredIndex = middle.findIndex((value, index) => index >= 3 && Boolean(rocToIso(value)));
  if (declaredIndex < 3 || declaredIndex >= middle.length - 1) {
    throw new Error(`建案 CSV 無法安全復位：${leading[1] || "未命名建案"}`);
  }

  const beforeMaterial = middle.slice(0, declaredIndex - 1);
  const material = middle[declaredIndex - 1];
  let zoningEnd = 1;
  let balance = parenthesisBalance(beforeMaterial[0] || "");
  while (balance > 0 && zoningEnd < beforeMaterial.length - 1) {
    balance += parenthesisBalance(beforeMaterial[zoningEnd]);
    zoningEnd += 1;
  }
  const zoning = beforeMaterial.slice(0, zoningEnd).join(",");
  const mainUse = beforeMaterial.slice(zoningEnd).join(",");
  if (!zoning || !mainUse || !material) throw new Error(`建案 CSV 缺少可安全復位的用途欄位：${leading[1] || "未命名建案"}`);

  const repaired = [
    ...leading,
    zoning,
    mainUse,
    material,
    middle[declaredIndex],
    middle.slice(declaredIndex + 1).join(","),
    ...tail,
  ];
  const record = cellsToRecord(headers, repaired);
  record.__sourceRepair = {
    status: "repaired-unquoted-commas",
    extraColumnCount: cells.length - headers.length,
    note: "官方 CSV 文字欄含未引用逗號；依固定尾欄、有效申報日期與括號邊界復位。",
  };
  return record;
}

export function parseBuildcaseCsv(text) {
  const { headers, rows } = parseCsvTable(text);
  return rows
    .map((cells) => repairBuildcaseCells(headers, cells))
    .filter((record) => !["TOWN", "The villages and towns urban district"].includes(record.鄉鎮市區));
}
