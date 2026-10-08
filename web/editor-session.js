// Keep the original editor runtime for unfinished input: a valid-document read
// cannot represent an empty field or another temporarily invalid form value.
export function createEditorSession({ensureActive,persistDraft}={}) {
  const entries = new Map();
  return {
    get: id => entries.get(id),
    values: () => [...entries.values()],
    add(id, entry) {
      if (entries.has(id)) throw new Error('本题编辑器已经打开');
      entries.set(id, entry);
      return entry;
    },
    remove(id) {
      const entry = entries.get(id);
      if (!entry) return;
      entries.delete(id);
      entry.plugin?.destroy();
      entry.container?.remove();
    },
    get isDirty() { return [...entries.values()].some(entry => entry.plugin?.isDirty||entry.changed); },
    async suspend(id) {
      const entry=entries.get(id);if(!entry?.plugin)return;
      const snapshot=await entry.plugin.exportDraft();
      if(!snapshot.supported){if(snapshot.changed)throw new Error('此拓展尚未支持编辑草稿恢复，请先保存修改。');this.remove(id);return;}
      // Persist the unvalidated working form before releasing its runtime.
      if(persistDraft)await persistDraft(id,entry,snapshot);
      entry.draft=persistDraft?null:structuredClone(snapshot.draft);entry.changed=snapshot.changed;
      if(persistDraft)entry.value={revision:entry.value.revision,contentVersion:entry.value.contentVersion,draftVersion:entry.value.draftVersion};
      entry.plugin.destroy();entry.plugin=null;entry.container?.remove();entry.container=null;
    },
    async hasChanges() {
      for (const entry of entries.values()) {
        if (entry.plugin?(await entry.plugin.getDocument({checkOnly:true})).changed:entry.changed) return true;
      }
      return false;
    },
    async saveAll(persist, onSaved = () => {}) {
      const changes = [];
      // Validate every changed question before committing any of them. Invalid
      // input stays inside its existing iframe and can be shown again directly.
      for (const [id, entry] of entries) {
        try {
          if(!entry.plugin){if(!entry.changed)continue;if(!ensureActive)throw new Error('编辑页面尚未恢复');await ensureActive(id,entry);}
          if (!(await entry.plugin.getDocument({checkOnly:true})).changed) continue;
          const {document} = await entry.plugin.getDocument();
          if (!document || typeof document.title !== 'string' || !document.data || typeof document.data !== 'object') throw new Error('编辑器没有返回有效题目');
          changes.push({id, entry, document});
        } catch (error) {
          throw Object.assign(error, {questionId:id, savedCount:0, phase:'validation'});
        }
      }
      let savedCount = 0;
      for (const change of changes) {
        try {
          const value = await persist(change);
          savedCount++;
          await onSaved(change, value);
        } catch (error) {
          throw Object.assign(error, {questionId:change.id, savedCount, pendingCount:changes.length-savedCount, phase:'saving'});
        }
      }
      return savedCount;
    },
    destroy() {
      for (const id of [...entries.keys()]) this.remove(id);
    }
  };
}
