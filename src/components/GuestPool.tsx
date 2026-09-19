import { useMemo, useState } from 'react';
import type { Guest } from '../types';
import { generateId, parseGuestsImport } from '../utils';
import type { ParsedGuestLine } from '../utils';
import { TAG_OPTIONS } from '../types';

interface Props {
  guests: Guest[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (guest: Guest) => void;
  onRemove: (guestId: string) => void;
  onDragStart: (id: string | null) => void;
  conflictMap: Map<string, string[]>;
  onUpdate?: (guest: Guest) => void;
  /** 批量操作（导入 / 成批修改）统一入口：整份 guests 一次替换，保证一次撤销可退回 */
  onReplaceGuests: (guests: Guest[], touchedIds: string[]) => void;
  /** 最近一次批量操作影响到的宾客 id（用于高亮区分） */
  touchedIds: Set<string>;
  onClearTouched: () => void;
}

type PreviewGroups = {
  normal: { line: ParsedGuestLine; index: number }[];
  dup: { line: ParsedGuestLine; index: number; reason: string }[];
  noName: { line: ParsedGuestLine; index: number }[];
};

export default function GuestPool({
  guests,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  onDragStart,
  conflictMap,
  onUpdate,
  onReplaceGuests,
  touchedIds,
  onClearTouched,
}: Props) {
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [preview, setPreview] = useState<ParsedGuestLine[] | null>(null);
  const [dupPicked, setDupPicked] = useState<Set<number>>(new Set());
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<'any' | 'all'>('any');
  const [search, setSearch] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [batchTag, setBatchTag] = useState(TAG_OPTIONS[0]);
  const [batchSize, setBatchSize] = useState('2');

  // 导入预览分组：正常 / 重名（需确认）/ 缺姓名（不可导入）
  const previewGroups: PreviewGroups | null = useMemo(() => {
    if (!preview) return null;
    const existing = new Set(guests.map((g) => g.name));
    const seen = new Set<string>();
    const groups: PreviewGroups = { normal: [], dup: [], noName: [] };
    preview.forEach((line, index) => {
      if (!line.name) {
        groups.noName.push({ line, index });
      } else if (existing.has(line.name)) {
        groups.dup.push({ line, index, reason: '与现有宾客重名' });
      } else if (seen.has(line.name)) {
        groups.dup.push({ line, index, reason: '文本内重复' });
      } else {
        seen.add(line.name);
        groups.normal.push({ line, index });
      }
    });
    return groups;
  }, [preview, guests]);

  const importableCount = previewGroups
    ? previewGroups.normal.length + previewGroups.dup.filter((d) => dupPicked.has(d.index)).length
    : 0;

  const handleParse = () => {
    setPreview(parseGuestsImport(importText));
    setDupPicked(new Set());
  };

  const handleConfirmImport = () => {
    if (!previewGroups || importableCount === 0) return;
    const picked = [
      ...previewGroups.normal,
      ...previewGroups.dup.filter((d) => dupPicked.has(d.index)),
    ];
    const newGuests: Guest[] = picked.map(({ line }) => ({
      id: generateId(),
      name: line.name,
      tags: line.tags,
      partySize: line.partySize,
    }));
    onReplaceGuests([...guests, ...newGuests], newGuests.map((g) => g.id));
    setImportText('');
    setPreview(null);
    setDupPicked(new Set());
    setShowImport(false);
  };

  const toggleFilterTag = (tag: string) => {
    setFilterTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const filtered = guests.filter((g) => {
    const matchTag =
      filterTags.length === 0 ||
      (filterMode === 'all'
        ? filterTags.every((t) => g.tags.includes(t))
        : filterTags.some((t) => g.tags.includes(t)));
    const matchSearch = !search || g.name.includes(search);
    return matchTag && matchSearch;
  });

  // 勾选的人可能已被删除，批量栏只统计仍存在的
  const checkedCount = guests.reduce((n, g) => n + (checkedIds.has(g.id) ? 1 : 0), 0);

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 对勾选人应用同一个修改；mutate 返回原对象表示该人无需变化，全部无变化时不产生历史记录 */
  const applyBatch = (mutate: (g: Guest) => Guest) => {
    if (checkedCount === 0) return;
    const next = guests.map((g) => (checkedIds.has(g.id) ? mutate(g) : g));
    if (!next.some((g, i) => g !== guests[i])) return;
    onReplaceGuests(next, guests.filter((g) => checkedIds.has(g.id)).map((g) => g.id));
  };

  const applyBatchSize = () => {
    const size = Math.max(1, Math.min(10, parseInt(batchSize) || 1));
    applyBatch((g) => (g.partySize === size ? g : { ...g, partySize: size }));
  };

  const addTagToChecked = () => {
    applyBatch((g) => (g.tags.includes(batchTag) ? g : { ...g, tags: [...g.tags, batchTag] }));
  };

  const removeTagFromChecked = () => {
    applyBatch((g) => (g.tags.includes(batchTag) ? { ...g, tags: g.tags.filter((t) => t !== batchTag) } : g));
  };

  const selectedGuest = guests.find((g) => g.id === selectedId);

  const renderPreviewLine = (line: ParsedGuestLine) => (
    <>
      <span className="preview-name">{line.name}</span>
      <span className="preview-meta">
        {line.tags.length > 0 && ` ${line.tags.join('、')}`}
        {line.partySize > 1 && ` · ${line.partySize}人`}
      </span>
      {line.unknown.length > 0 && (
        <span className="preview-unknown" title="这些词不是预设标签，导入时会被忽略">
          （忽略: {line.unknown.join('、')}）
        </span>
      )}
    </>
  );

  return (
    <div className="guest-pool">
      <h3>宾客池 ({guests.length})</h3>
      <div className="pool-actions">
        <button onClick={() => setShowImport((s) => !s)}>批量导入</button>
        <button onClick={() => onAdd({ id: generateId(), name: '新宾客', tags: [], partySize: 1 })}>添加宾客</button>
      </div>
      {showImport && (
        <div className="import-panel">
          <textarea
            placeholder={'粘贴姓名，每行一个，可带标签和人数\n如：张三 男方亲属 3人'}
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setPreview(null);
              setDupPicked(new Set());
            }}
            rows={5}
          />
          <div className="import-actions">
            <button onClick={handleParse} disabled={!importText.trim()}>解析预览</button>
            {preview && (
              <button className="cancel" onClick={() => { setPreview(null); setDupPicked(new Set()); }}>
                重新编辑
              </button>
            )}
          </div>
          {previewGroups && (
            <div className="import-preview">
              {previewGroups.normal.length > 0 && (
                <div className="preview-section">
                  <h4>将导入 {previewGroups.normal.length} 人</h4>
                  <ul>
                    {previewGroups.normal.map(({ line, index }) => (
                      <li key={index}>{renderPreviewLine(line)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {previewGroups.dup.length > 0 && (
                <div className="preview-section dup-section">
                  <h4>重名 {previewGroups.dup.length} 条（勾选后才会导入）</h4>
                  <ul>
                    {previewGroups.dup.map(({ line, index, reason }) => (
                      <li key={index}>
                        <label className="preview-dup-label">
                          <input
                            type="checkbox"
                            checked={dupPicked.has(index)}
                            onChange={(e) => {
                              setDupPicked((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(index);
                                else next.delete(index);
                                return next;
                              });
                            }}
                          />
                          {renderPreviewLine(line)}
                          <span className="preview-reason">{reason}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {previewGroups.noName.length > 0 && (
                <div className="preview-section noname-section">
                  <h4>缺少姓名 {previewGroups.noName.length} 条（不会导入）</h4>
                  <ul>
                    {previewGroups.noName.map(({ line, index }) => (
                      <li key={index} className="preview-raw">“{line.raw}”</li>
                    ))}
                  </ul>
                </div>
              )}
              {previewGroups.normal.length + previewGroups.dup.length + previewGroups.noName.length === 0 && (
                <div className="preview-empty">没有可解析的内容</div>
              )}
            </div>
          )}
          {previewGroups && (
            <div className="import-actions">
              <button onClick={handleConfirmImport} disabled={importableCount === 0}>
                确认导入（{importableCount} 人）
              </button>
            </div>
          )}
        </div>
      )}
      <div className="pool-filters">
        <input placeholder="搜索姓名" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="tag-filter">
        {TAG_OPTIONS.map((t) => (
          <button
            key={t}
            className={`tag-filter-chip ${filterTags.includes(t) ? 'active' : ''}`}
            onClick={() => toggleFilterTag(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {filterTags.length > 0 && (
        <div className="tag-filter-options">
          {filterTags.length > 1 && (
            <button
              onClick={() => setFilterMode((m) => (m === 'any' ? 'all' : 'any'))}
              title="点击切换：含有任一选中标签即显示，或必须同时含有全部选中标签"
            >
              {filterMode === 'any' ? '任一满足' : '全部满足'}
            </button>
          )}
          <button onClick={() => setFilterTags([])}>清除筛选</button>
        </div>
      )}
      {checkedCount > 0 && (
        <div className="batch-bar">
          <div className="batch-bar-row">
            <span className="batch-count">已选 {checkedCount} 人</span>
            <button onClick={() => setCheckedIds(new Set(filtered.map((g) => g.id)))}>全选筛选结果</button>
            <button onClick={() => setCheckedIds(new Set())}>清除</button>
          </div>
          <div className="batch-bar-row">
            <label>随行人数</label>
            <input
              type="number"
              min={1}
              max={10}
              value={batchSize}
              onChange={(e) => setBatchSize(e.target.value)}
            />
            <button onClick={applyBatchSize}>应用</button>
          </div>
          <div className="batch-bar-row">
            <label>标签</label>
            <select value={batchTag} onChange={(e) => setBatchTag(e.target.value)}>
              {TAG_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button onClick={addTagToChecked}>＋添加</button>
            <button onClick={removeTagFromChecked}>－移除</button>
          </div>
        </div>
      )}
      {touchedIds.size > 0 && (
        <div className="touched-notice">
          <span>上次批量操作影响了 {touchedIds.size} 人（蓝色高亮）</span>
          <button onClick={onClearTouched}>清除标记</button>
        </div>
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
          const isTouched = touchedIds.has(g.id);
          return (
            <div
              key={g.id}
              className={`guest-chip ${selectedId === g.id ? 'selected' : ''} ${isConflict ? 'conflict' : ''} ${isTouched ? 'touched' : ''}`}
              draggable
              onDragStart={() => onDragStart(g.id)}
              onDragEnd={() => onDragStart(null)}
              onClick={() => onSelect(selectedId === g.id ? null : g.id)}
            >
              <input
                type="checkbox"
                className="guest-check"
                checked={checkedIds.has(g.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleCheck(g.id)}
              />
              <span className="guest-name">{g.name}</span>
              {g.partySize > 1 && <span className="guest-party">{g.partySize}人</span>}
              {g.tags.length > 0 && <span className="guest-tags">{g.tags.join(', ')}</span>}
              {isTouched && <span className="touched-badge">已改</span>}
              {isConflict && (
                <span
                  className="conflict-badge"
                  title={`冲突: ${conflicts.map((c) => guests.find((gg) => gg.id === c)?.name || c).join(', ')}`}
                >!</span>
              )}
              <button className="guest-remove" onClick={(e) => { e.stopPropagation(); onRemove(g.id); }}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
