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

export type ParsedGuest = {
  name: string;
  tags: string[];
  partySize: number;
};

/**
 * 解析批量导入文本：每行（或逗号/分号分隔）一个宾客。
 * - 非预设标签的词一律忽略，第一个剩余的词当作姓名；没有剩余词则姓名为空（交给导入预览确认）
 * - 识别随行人数：`3人`、`一家3口`、`3位` 视作总人数；`带2位家属/家属2人` 视作总人数 = 数字 + 1
 * - 行内单独的数字（如 `张三 4`）按总人数处理
 */
export function parseGuestsText(text: string): ParsedGuest[] {
  const lines = text.split(/\n|，|,|;/).map((s) => s.trim()).filter(Boolean);
  const result: ParsedGuest[] = [];
  for (const line of lines) {
    const tokens = line.split(/\s+/).filter(Boolean);
    const tags: string[] = [];
    const rest: string[] = [];
    let partySize = 1;
    let hasSize = false;

    for (const raw of tokens) {
      const withFamily = raw.match(/^(?:带)?(\d+)\s*(?:位|名)?\s*家属/);
      const familySuffix = raw.match(/家属\s*(\d+)\s*(?:位|名)?人?$/);
      const total = raw.match(/^(\d+)\s*(?:人|口|位|名)?$/) || raw.match(/(?:一家|全家)\s*(\d+)\s*(?:人|口)/);
      if (withFamily || familySuffix) {
        const n = Number((withFamily || familySuffix)![1]);
        partySize = clampPartySize(n + 1);
        hasSize = true;
      } else if (total) {
        partySize = clampPartySize(Number(total[1]));
        hasSize = true;
      } else if (TAG_OPTIONS.includes(raw)) {
        if (!tags.includes(raw)) tags.push(raw);
      } else {
        rest.push(raw);
      }
    }

    result.push({
      name: rest.length > 0 ? rest[0] : '',
      tags,
      partySize: hasSize ? partySize : 1,
    });
  }
  return result;
}

function clampPartySize(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(10, Math.floor(n)));
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
