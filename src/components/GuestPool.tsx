import { useMemo, useState } from 'react';
import type { Guest } from '../types';
import { generateId, parseGuestsText } from '../utils';
import { TAG_OPTIONS } from '../types';

type ImportStage = 'input' | 'preview';

type ImportRow = {
  key: number;
  name: string;
  tags: string[];
  partySize: number;
  include: boolean;
};

type BatchTagMode = 'add' | 'remove' | 'keep';

interface Props {
  guests: Guest[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (guest: Guest) => void;
  onRemove: (guestId: string) => void;
  onDragStart: (id: string | null) => void;
  conflictMap: Map<string, string[]>;
  onUpdate?: (guest: Guest) => void;
  /** 批量更新（标签 / 随行人数），调用方一次性写入历史栈，撤销即可整体退回 */
  onBatchUpdate?: (
    guestIds: string[],
    patch: { addTags?: string[]; removeTags?: string[]; partySize?: number },
  ) => void;
  /** 清除批量修改标记 */
  onClearBatchMarks?: (guestIds: string[]) => void;
}

export default function GuestPool(
  { guests, selectedId, onSelect, onAdd, onRemove, onDragStart, conflictMap, onUpdate, onBatchUpdate, onClearBatchMarks }: Props,
) {
  const [showImport, setShowImport] = useState(false);
  const [importStage, setImportStage] = useState<ImportStage>('input');
  const [importText, setImportText] = useState('');
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [batchPartyInput, setBatchPartyInput] = useState('');
  const [batchTagModes, setBatchTagModes] = useState<Record<string, BatchTagMode>>({});

  const closeImport = () => {
    setShowImport(false);
    setImportStage('input');
    setImportText('');
    setImportRows([]);
  };

  // ---------- 批量导入：先解析预览，重名/无名行挑出来人工确认 ----------
  const goPreview = () => {
    const parsed = parseGuestsText(importText);
    const seen = new Set<string>();
    const rows: ImportRow[] = parsed.map((p, i) => {
      const trimmed = p.name.trim();
      const dupInText = trimmed ? seen.has(trimmed) : false;
      if (trimmed) seen.add(trimmed);
      const dupInPool = !!trimmed && guests.some((g) => g.name === trimmed);
      // 无名 / 文本内重名 / 与池中重名，默认不勾选
      const include = !!trimmed && !dupInText && !dupInPool;
      return { key: i, name: trimmed, tags: p.tags, partySize: p.partySize, include };
    });
    setImportRows(rows);
    setImportStage('preview');
  };

  const setRowName = (key: number, name: string) => {
    setImportRows((rows) => rows.map((r) => {
      if (r.key !== key) return r;
      // 名字被清空时不允许保持勾选
      return { ...r, name, include: name.trim() ? r.include : false };
    }));
  };

  const toggleRow = (key: number) => {
    setImportRows((rows) => rows.map((r) => {
      if (r.key !== key) return r;
      // 无名行不允许直接勾选，必须先补名字
      if (!r.name.trim()) return r;
      return { ...r, include: !r.include };
    }));
  };

  const rowIssues = useMemo(() => {
    const map = new Map<number, string[]>();
    const counts = new Map<string, number>();
    for (const r of importRows) {
      const n = r.name.trim();
      if (n) counts.set(n, (counts.get(n) || 0) + 1);
    }
    for (const r of importRows) {
      const issues: string[] = [];
      const n = r.name.trim();
      if (!n) issues.push('未写名字');
      if (n && (counts.get(n) || 0) > 1) issues.push('文本内重名');
      if (n && guests.some((g) => g.name === n)) issues.push('与池中重名');
      map.set(r.key, issues);
    }
    return map;
  }, [importRows, guests]);

  const issueCount = useMemo(
    () => importRows.filter((r) => (rowIssues.get(r.key) || []).length > 0).length,
    [importRows, rowIssues],
  );

  const confirmImport = () => {
    for (const r of importRows) {
      if (!r.include || !r.name.trim()) continue;
      onAdd({ id: generateId(), name: r.name.trim(), tags: r.tags, partySize: r.partySize });
    }
    closeImport();
  };

  // ---------- 筛选：标签多选（命中任一即可），再与姓名搜索叠加（两者都满足才显示） ----------
  const toggleFilterTag = (tag: string) => {
    setFilterTags((tags) =>
      tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag],
    );
  };

  const filtered = guests.filter((g) => {
    const matchTag = filterTags.length === 0 || filterTags.some((t) => g.tags.includes(t));
    const matchSearch = !search || g.name.includes(search);
    return matchTag && matchSearch;
  });

  // ---------- 列表勾选 + 成批改标签 / 随行人数 ----------
  const checkedGuests = guests.filter((g) => checkedIds.has(g.id));

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilteredChecked = filtered.length > 0 && filtered.every((g) => checkedIds.has(g.id));
  const toggleCheckAll = () => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredChecked) {
        for (const g of filtered) next.delete(g.id);
      } else {
        for (const g of filtered) next.add(g.id);
      }
      return next;
    });
  };

  const cycleTagMode = (tag: string) => {
    setBatchTagModes((modes) => {
      const order: BatchTagMode[] = ['keep', 'add', 'remove'];
      const cur = modes[tag] || 'keep';
      return { ...modes, [tag]: order[(order.indexOf(cur) + 1) % order.length] };
    });
  };

  const applyBatch = () => {
    if (checkedGuests.length === 0 || !onBatchUpdate) return;
    const ids = checkedGuests.map((g) => g.id);
    const addTags = TAG_OPTIONS.filter((t) => batchTagModes[t] === 'add');
    const removeTags = TAG_OPTIONS.filter((t) => batchTagModes[t] === 'remove');
    const patch: { addTags?: string[]; removeTags?: string[]; partySize?: number } = {};
    if (addTags.length) patch.addTags = addTags;
    if (removeTags.length) patch.removeTags = removeTags;
    const party = parseInt(batchPartyInput, 10);
    if (Number.isFinite(party)) patch.partySize = Math.max(1, Math.min(10, party));
    onBatchUpdate(ids, patch);
    setBatchPartyInput('');
    setBatchTagModes({});
  };

  const clearMarks = () => {
    const marked = checkedGuests.filter((g) => g.batchUpdated).map((g) => g.id);
    if (marked.length > 0 && onClearBatchMarks) onClearBatchMarks(marked);
  };

  const clearSelection = () => setCheckedIds(new Set());

  const selectedGuest = guests.find((g) => g.id === selectedId);

  return (
    <div className="guest-pool">
      <h3>宾客池 ({guests.length})</h3>
      <div className="pool-actions">
        <button onClick={() => {
          if (showImport) closeImport();
          else setShowImport(true);
        }}>批量导入</button>
        <button onClick={() => onAdd({ id: generateId(), name: '新宾客', tags: [], partySize: 1 })}>添加宾客</button>
      </div>

      {showImport && importStage === 'input' && (
        <div className="import-panel">
          <textarea
            placeholder={'粘贴宾客信息，每行一个，例如：\n张三 男方亲属 3人\n李四 同事 带2位家属\n（非预设标签自动忽略；不写名字 / 重名的行会在下一步挑出来确认）'}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
          />
          <div className="import-btns">
            <button onClick={goPreview} disabled={!importText.trim()}>解析预览</button>
            <button className="btn-ghost" onClick={closeImport}>取消</button>
          </div>
        </div>
      )}

      {showImport && importStage === 'preview' && (
        <div className="import-preview">
          <div className="import-summary">
            共解析 {importRows.length} 人
            {issueCount > 0 && <span className="issue-count">，{issueCount} 行待确认（未写名字 / 重名，默认不导入）</span>}
          </div>
          <div className="import-rows">
            {importRows.map((r) => {
              const issues = rowIssues.get(r.key) || [];
              return (
                <div key={r.key} className={`import-row ${issues.length > 0 ? 'has-issue' : ''}`}>
                  <input
                    type="checkbox"
                    checked={r.include}
                    onChange={() => toggleRow(r.key)}
                    disabled={!r.name.trim()}
                  />
                  <input
                    className="import-name-input"
                    value={r.name}
                    placeholder="（未写名字）"
                    onChange={(e) => setRowName(r.key, e.target.value)}
                  />
                  {r.tags.length > 0 && <span className="guest-tags">{r.tags.join(', ')}</span>}
                  <span className="import-size">{r.partySize}人</span>
                  {issues.length > 0 && <span className="issue-badge" title={issues.join('；')}>{issues.join('/')}</span>}
                </div>
              );
            })}
          </div>
          <div className="import-btns">
            <button onClick={confirmImport} disabled={!importRows.some((r) => r.include && r.name.trim())}>
              导入勾选的 {importRows.filter((r) => r.include).length} 人
            </button>
            <button className="btn-ghost" onClick={() => setImportStage('input')}>返回修改</button>
            <button className="btn-ghost" onClick={closeImport}>取消</button>
          </div>
        </div>
      )}

      <input className="pool-search" placeholder="搜索姓名" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="tag-filter">
        {TAG_OPTIONS.map((t) => (
          <button
            key={t}
            type="button"
            className={`tag-pill ${filterTags.includes(t) ? 'active' : ''}`}
            onClick={() => toggleFilterTag(t)}
          >
            {t}
          </button>
        ))}
        {filterTags.length > 0 && (
          <button type="button" className="tag-clear" onClick={() => setFilterTags([])}>清除筛选</button>
        )}
      </div>

      {checkedGuests.length > 0 && (
        <div className="batch-bar">
          <div className="batch-title">已勾选 {checkedGuests.length} 人</div>
          <div className="tag-checkboxes">
            {TAG_OPTIONS.map((tag) => {
              const mode = batchTagModes[tag] || 'keep';
              return (
                <button
                  key={tag}
                  type="button"
                  className={`tag-pill batch-tag mode-${mode}`}
                  title={mode === 'keep' ? '保持不变（点击改为：加上此标签）' : mode === 'add' ? '加上此标签（点击改为：去掉此标签）' : '去掉此标签（点击改为：保持不变）'}
                  onClick={() => cycleTagMode(tag)}
                >
                  {mode === 'add' ? '＋' : mode === 'remove' ? '－' : '·'}{tag}
                </button>
              );
            })}
          </div>
          <label className="batch-size">
            随行人数
            <input
              type="number"
              min={1}
              max={10}
              placeholder="不改"
              value={batchPartyInput}
              onChange={(e) => setBatchPartyInput(e.target.value)}
            />
          </label>
          <div className="batch-btns">
            <button className="btn-apply" onClick={applyBatch}>应用修改</button>
            <button className="btn-ghost" onClick={clearMarks}>清除改后标记</button>
            <button className="btn-ghost" onClick={clearSelection}>取消勾选</button>
          </div>
        </div>
      )}

      {checkedGuests.length === 0 && filtered.length > 0 && (
        <label className="check-all">
          <input type="checkbox" checked={allFilteredChecked} onChange={toggleCheckAll} />
          全选当前列表（{filtered.length}）
        </label>
      )}

      {selectedGuest && onUpdate && (
        <div className="guest-editor">
          <label>
            姓名
            <input
              value={selectedGuest.name}
              onChange={(e) => onUpdate({ ...selectedGuest, name: e.target.value })}
            />
          </label>
          <label>
            人数
            <input
              type="number"
              min={1}
              max={10}
              value={selectedGuest.partySize}
              onChange={(e) => onUpdate({ ...selectedGuest, partySize: Math.max(1, Math.min(10, parseInt(e.target.value) || 1)) })}
            />
          </label>
          <label>
            标签
            <div className="tag-checkboxes">
              {TAG_OPTIONS.map((tag) => (
                <label key={tag} className="tag-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedGuest.tags.includes(tag)}
                    onChange={(e) => {
                      const tags = e.target.checked
                        ? [...selectedGuest.tags, tag]
                        : selectedGuest.tags.filter((t) => t !== tag);
                      onUpdate({ ...selectedGuest, tags });
                    }}
                  />
                  {tag}
                </label>
              ))}
            </div>
          </label>
          <label>
            备注
            <input
              value={selectedGuest.note || ''}
              onChange={(e) => onUpdate({ ...selectedGuest, note: e.target.value })}
            />
          </label>
          <label className="child-seat-label">
            <input
              type="checkbox"
              checked={!!selectedGuest.childSeat}
              onChange={(e) => onUpdate({ ...selectedGuest, childSeat: e.target.checked })}
            />
            儿童椅
          </label>
        </div>
      )}
      <div className="guest-list">
        {filtered.map((g) => {
          const conflicts = conflictMap.get(g.id) || [];
          const isConflict = conflicts.length > 0;
          return (
            <div
              key={g.id}
              className={`guest-chip ${selectedId === g.id ? 'selected' : ''} ${isConflict ? 'conflict' : ''} ${checkedIds.has(g.id) ? 'checked' : ''}`}
              draggable
              onDragStart={() => onDragStart(g.id)}
              onDragEnd={() => onDragStart(null)}
              onClick={() => onSelect(selectedId === g.id ? null : g.id)}
            >
              <input
                type="checkbox"
                className="chip-check"
                checked={checkedIds.has(g.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleCheck(g.id)}
                draggable={false}
                title="勾选以批量修改"
              />
              <span className="guest-name">{g.name}</span>
              <span className="guest-size">{g.partySize > 1 ? `${g.partySize}人` : ''}</span>
              {g.tags.length > 0 && <span className="guest-tags">{g.tags.join(', ')}</span>}
              <span className="chip-badges">
                {g.batchUpdated && <span className="batch-badge" title="经批量操作修改过">已改</span>}
                {isConflict && (
                  <span
                    className="conflict-badge"
                    title={`冲突: ${conflicts.map((c) => guests.find((gg) => gg.id === c)?.name || c).join(', ')}`}
                  >!</span>
                )}
              </span>
              <button className="guest-remove" onClick={(e) => { e.stopPropagation(); onRemove(g.id); }}>×</button>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="pool-empty">没有符合条件的宾客</div>}
      </div>
    </div>
  );
}
