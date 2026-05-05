import { dataToLevel0L } from "./level0l.js";

function normalizeRelationMember(member) {
  return {
    type: member.type,
    id: member.ref ?? member.id,
    role: member.role ?? ""
  };
}

function normalizeOsmData(osmData) {
  return osmData.map((item) => {
    if (item.type === "relation") {
      return {
        ...item,
        members: (item.members ?? []).map(normalizeRelationMember)
      };
    }

    return item;
  });
}

export function osmDataToL0L(osmData) {
  const data = normalizeOsmData(typeof osmData === "string" ? JSON.parse(osmData) : osmData);
  return dataToLevel0L(data);
}

export function overpassToL0L(osmData) {
  return osmDataToL0L(osmData);
}
