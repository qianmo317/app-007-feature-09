import { v4 as uuidv4 } from 'uuid';
import type { Plan } from './types';
import { TAG_OPTIONS } from './types';

export function generateId(): string {
  return uuidv4();
}

export function createEmptyPlan(name = '未命名方案'): Plan {
  return {
    id: generateId(),
    name,
    tables: [],
    guests: [],
    rules: [],
    updatedAt: Date.now(),
  };
}

export function clonePlan(plan: Plan): Plan {
  return JSON.parse(JSON.stringify(plan));
}

export function getConflictMap(plan: Plan): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const { tables, rules } = plan;

  for (const rule of rules) {
    if (rule.type === 'apart') {
      for (const table of tables) {
        const hasA = table.seatOrder.includes(rule.a);
        const hasB = table.seatOrder.includes(rule.b);
        if (hasA && hasB) {
          if (!map.has(rule.a)) map.set(rule.a, []);
          if (!map.has(rule.b)) map.set(rule.b, []);
          if (!map.get(rule.a)!.includes(rule.b)) map.get(rule.a)!.push(rule.b);
          if (!map.get(rule.b)!.includes(rule.a)) map.get(rule.b)!.push(rule.a);
        }
      }
    } else if (rule.type === 'separate') {
      for (const table of tables) {
        const hasA = table.seatOrder.includes(rule.a);
        const hasB = table.seatOrder.includes(rule.b);
        if (hasA && hasB) {
          if (!map.has(rule.a)) map.set(rule.a, []);
          if (!map.has(rule.b)) map.set(rule.b, []);
          if (!map.get(rule.a)!.includes(rule.b)) map.get(rule.a)!.push(rule.b);
          if (!map.get(rule.b)!.includes(rule.a)) map.get(rule.b)!.push(rule.a);
        }
      }
    } else if (rule.type === 'together') {
      let same = false;
      for (const table of tables) {
        const hasA = table.seatOrder.includes(rule.a);
        const hasB = table.seatOrder.includes(rule.b);
        if (hasA && hasB) same = true;
      }
      if (!same) {
        const ta = tables.find((t) => t.seatOrder.includes(rule.a));
        const tb = tables.find((t) => t.seatOrder.includes(rule.b));
        if (ta && tb && ta.id !== tb.id) {
          if (!map.has(rule.a)) map.set(rule.a, []);
          if (!map.has(rule.b)) map.set(rule.b, []);
          if (!map.get(rule.a)!.includes(rule.b)) map.get(rule.a)!.push(rule.b);
          if (!map.get(rule.b)!.includes(rule.a)) map.get(rule.b)!.push(rule.a);
        }
      }
    }
  }
  return map;
}

export function getTableStats(plan: Plan) {
  let seated = 0;
  let capacity = 0;
  let emptySeats = 0;
  const unassigned = plan.guests.filter((g) => {
    const atTable = plan.tables.some((t) => t.seatOrder.includes(g.id));
    return !atTable;
  });
  for (const t of plan.tables) {
    seated += t.seatOrder.length;
    capacity += t.capacity;
    emptySeats += Math.max(0, t.capacity - t.seatOrder.length);
  }
  return { seated, capacity, emptySeats, totalGuests: plan.guests.length, unassignedCount: unassigned.length };
}

export type ParsedGuestLine = {
  raw: string; // 原始文本行
  name: string; // 解析出的姓名，空串表示缺姓名
  tags: string[]; // 识别出的预设标签
  partySize: number; // 随行人数（含本人），默认 1
  unknown: string[]; // 无法识别的词
};

const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 识别 "3" "3人" "x3" "×3" "三人" 这类随行人数写法，识别不了返回 null */
export function parsePartySizeToken(token: string): number | null {
  let m = /^[xX×*](\d{1,2})$/.exec(token);
  if (m) return parseInt(m[1], 10);
  m = /^(\d{1,2})人?$/.exec(token);
  if (m) return parseInt(m[1], 10);
  m = /^([一二两三四五六七八九十])[人口]$/.exec(token);
  if (m) return CN_NUM[m[1]];
  return null;
}

/**
 * 解析批量导入文本：每行（或分号分隔）一位宾客，
 * 行内可混写预设标签与随行人数（如 "张三 男方亲属 3人"）。
 * 空行忽略；解析不出姓名的行也会保留（name 为空），交由调用方提示确认。
 */
export function parseGuestsImport(text: string): ParsedGuestLine[] {
  const records = text.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  return records.map((raw) => {
    const tokens = raw.split(/[\s，,、]+/).filter(Boolean);
    const tags: string[] = [];
    const unknown: string[] = [];
    let name = '';
    let partySize = 1;
    for (const token of tokens) {
      if (TAG_OPTIONS.includes(token)) {
        if (!tags.includes(token)) tags.push(token);
        continue;
      }
      const size = parsePartySizeToken(token);
      if (size !== null) {
        partySize = Math.max(1, Math.min(99, size));
        continue;
      }
      if (!name) {
        name = token;
      } else {
        unknown.push(token);
      }
    }
    return { raw, name, tags, partySize, unknown };
  });
}

export function exportPlanToJSON(plan: Plan): string {
  return JSON.stringify(plan, null, 2);
}

export function importPlanFromJSON(json: string): Plan | null {
  try {
    const p = JSON.parse(json);
    if (p.id && p.name && Array.isArray(p.tables) && Array.isArray(p.guests) && Array.isArray(p.rules)) {
      return p as Plan;
    }
  } catch {}
  return null;
}
