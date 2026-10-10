const unavailable = () => { const error = new Error('DEVELOPMENT_NOT_IMPLEMENTED: UI 原型尚未实现真实保存和判分。'); error.code='DEVELOPMENT_NOT_IMPLEMENTED'; throw error; };
QF.defineType({
 project(data,context) { const value=JSON.parse(JSON.stringify(data)); if(!context?.submitted) { delete value.referenceAnswer; delete value.rubric; delete value.explanation; for(const part of value.parts||[]) { delete part.correctOptionId; delete part.referenceAnswer; delete part.explanation; delete part.rubric; } for(const slot of value.sequence||[]) if(!slot.fixed) delete slot.paragraphId; } return value; },
 getScore(data,state) { return {score:state?.submitted?state.result?.score??null:0,maxScore:data.maxScore}; },
 getOutlineItems(data) { return data.parts?.map(p=>({id:p.id,label:p.label})) || data.sequence?.filter(p=>!p.fixed).map((p,i)=>({id:p.id,label:p.label||String(41+i)})) || []; },
 validateQuestion(data) {
   if(!data || typeof data !== 'object' || typeof data.directions !== 'string' || data.stem?.type !== 'doc' || !Array.isArray(data.stem.content) || !Number.isFinite(data.maxScore) || data.maxScore<=0) return false;
   if(data.parts) {
     if(!Array.isArray(data.parts) || !data.parts.length || new Set(data.parts.map(p=>p.id)).size!==data.parts.length) return false;
     for(const p of data.parts) {
       if(typeof p.id!=='string' || !p.id || typeof p.label!=='string' || !p.label || !Number.isFinite(p.maxScore) || p.maxScore<=0) return false;
       if(p.options && (!Array.isArray(p.options) || p.options.length!==4 || new Set(p.options.map(o=>o.id)).size!==4 || !p.options.every(o=>typeof o.id==='string' && typeof o.text==='string') || !p.options.some(o=>o.id===p.correctOptionId))) return false;
     }
   }
   if(data.sequence) {
     if(!Array.isArray(data.paragraphs) || !Array.isArray(data.sequence) || data.sequence.length!==data.paragraphs.length || data.sequence.filter(s=>s.fixed===true).length<3) return false;
     const ids=data.paragraphs.map(p=>p.id);
     if(new Set(ids).size!==ids.length || new Set(data.sequence.map(s=>s.id)).size!==ids.length || new Set(data.sequence.map(s=>s.paragraphId)).size!==ids.length || !data.sequence.every(s=>ids.includes(s.paragraphId) && typeof s.fixed==='boolean')) return false;
   }
   return true;
 }, validateAnswer:unavailable, grade:unavailable, review:unavailable
});