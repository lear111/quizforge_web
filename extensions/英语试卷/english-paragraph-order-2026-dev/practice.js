const EXAM_KIND="paragraph-order";
const EXAM_DEMO_FIXTURES={"sample-order-2026": {"directions": "Reorganize paragraphs A–H into a coherent text. At least three paragraphs remain fixed. (10 points)", "stem": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "The following paragraphs are given in a wrong order. Reorganize them into a coherent text."}]}]}, "paragraphs": [{"id": "A", "text": "And just read a single poem. In his Oxford lectures, Seamus Heaney argued that a poem draws a picture of reality, a “glimpsed alternative” that sets up a contradiction with your own, in ways little and large. The negotiation, between you and it, is the heart of the matter. What does the poet see that you don’t? What does the difference mean? It could be one of the best conversations you ever have. Forget self-help books; reading is self-help in action."}, {"id": "B", "text": "But for the most part, this isn’t what the business community does. I have yet to meet a chief executive who reads regularly. Many skip newspapers, and magazines are a stretch. They don’t have time, they say. It’s inefficient; they can get the information they need from those around them. At a pinch, they might pick up a business book before a long flight, in the hope that, like a cookbook, it will provide a foolproof recipe. Some are drawn to what I think of as “business car crash” books—the stories of Theranos, Purdue, WeWork. But outside those narrow pools of interest, a vast ocean awaits, bountiful with simmering ideas, mental adventure and imaginative refreshment."}, {"id": "C", "text": "Neuroscientists have been at pains to demonstrate that the pleasure a book provides isn’t indulgence; it’s good for you. Reading will keep you better informed about the world but it can also improve our tech-shattered ability to concentrate. Standing in the shoes of others fine tunes our social understanding, useful as we struggle to understand friends, neighbours, customers and co-workers. Different parts of our brain engage as we simulate scenes, characters and mental states. Our imagination—remember that?—is rekindled."}, {"id": "D", "text": "It is undoubtedly true that all work and no play really does make Jack, or Jill, dull. The cure is right at hand. Reading is cheap, easy and, most important, it’s fun. Liberate your imagination this year."}, {"id": "E", "text": "We are living through a golden age of science writing, so lucid and accessible that even lay readers can relish the unpredictability of discovery. Daunted by uncertainty? Stand in the shoes of scientists and witness the degree to which breakthroughs emerge from accidents, conflict and sheer mental stamina. “We are never sure of anything,” says the physicist (and writer) Carlo Rovelli."}, {"id": "F", "text": "You don’t need to get out more. If, like most business people, you spend your life dashing from office to plane, train to home, boardroom to washroom, what you really need to do is stay in more, sit down—and read a book."}, {"id": "G", "text": "Reading has also been found to make us more helpful, to reduce bias, and even to increase longevity—something we will enjoy all the more if we have a good book in our hands. (And yes, all these benefits are more closely associated with physical books than digital ones.)"}, {"id": "H", "text": "Read fiction. Any fiction. Free yourself from algorithms and choose— anything. You don’t need technology for an immersive experience—just surrender to narratives across time and place. Modern (Sebastian Barry or Olga Tokarczuk), classic (Virginia Woolf or James Baldwin) or genre (Stephen King, Margaret Atwood, Georges Simenon)—it doesn’t matter. Fiction invites you to loiter unseen in the lives of others. We are living through a golden age of translation too, so you can go anywhere in time or place."}], "sequence": [{"id": "position-1", "label": "", "paragraphId": "F", "fixed": true}, {"id": "position-2", "label": "41", "paragraphId": "B", "fixed": false}, {"id": "position-3", "label": "42", "paragraphId": "E", "fixed": false}, {"id": "position-4", "label": "", "paragraphId": "H", "fixed": true}, {"id": "position-5", "label": "43", "paragraphId": "A", "fixed": false}, {"id": "position-6", "label": "", "paragraphId": "C", "fixed": true}, {"id": "position-7", "label": "44", "paragraphId": "G", "fixed": false}, {"id": "position-8", "label": "45", "paragraphId": "D", "fixed": false}], "explanation": "", "maxScore": 10}};
(() => {
  const root=document.getElementById('exam');
  let current=null, values={}, demoSubmitted=false, demoScore=0, disposed=false;
  const renders=[], targets=new Map();
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const submitted=()=>demoSubmitted||current?.status==='submitted';
  const history=()=>current?.mode==='history';
  const demoData=()=>demoSubmitted?EXAM_DEMO_FIXTURES[current.question.id]:current.question.data;
  const publicData=()=>current.question.data;
  const notify=(text,error=false)=>{const n=root.querySelector('.notice');if(n){n.textContent=text;n.classList.toggle('error',error);}QF.ui.resize();};
  function disposeRenderers(){for(const r of renders.splice(0))r.destroy();targets.clear();}
  function rich(parent,doc){const n=el('div','rich-content');parent.append(n);if(doc?.content?.length)renders.push(QF.content.render(n,doc));return n;}
  function grow(input){input.style.height='auto';input.style.height=Math.max(input.classList.contains('writing-answer')?245:126,input.scrollHeight)+'px';}
  function remember(){document.dispatchEvent(new CustomEvent('exam-prototype-input',{detail:{questionId:current.question.id,answer:{values:{...values}}}}));}
  function resultFor(part){const data=demoData();const p=data.parts?.find(x=>x.id===part.id);return p?.correctOptionId;}
  function choices(part,cloze){
    const section=el('section',cloze?'part cloze-part':'part');section.id=part.id;section.tabIndex=-1;targets.set(part.id,section);
    const heading=el('h2','part-heading');heading.append(el('span','part-number',part.label+'.'));
    if(part.stem)heading.append(document.createTextNode(part.stem));section.append(heading);
    const list=el('div',cloze?'choices cloze-choices':'choices');
    for(const option of part.options){
      const label=el('label','choice');const input=el('input');input.type='radio';input.name=part.id;input.value=option.id;input.dataset.part=part.id;input.checked=values[part.id]===option.id;input.disabled=submitted()||history();input.setAttribute('aria-label',`${part.label} ${option.id}. ${option.text}`);
      const key=submitted()?resultFor(part):null;
      label.classList.toggle('is-selected',input.checked);label.classList.toggle('is-correct',key===option.id);label.classList.toggle('is-incorrect',!!key&&input.checked&&key!==option.id);
      label.append(input,el('span','choice-letter',option.id),el('span',null,option.text));list.append(label);
    }
    section.append(list);
    if(submitted()){const key=resultFor(part), answered=!!values[part.id];const note=el('p','part-result'+(!answered?' unanswered':''),`${!answered?'未答 · ':''}答案 ${key||'—'}${demoSubmitted?' · 界面演示':''}`);section.append(note);}
    return section;
  }
  function order(parent){
    const data=demoData();
    for(const paragraph of data.paragraphs){const row=el('div','order-paragraph');row.append(el('span','paragraph-letter',paragraph.id),el('div','rich-content',paragraph.text));parent.append(row);}
    const sequence=el('div','order-sequence');
    const fixed=data.sequence.filter(s=>s.fixed).map(s=>s.paragraphId);
    data.sequence.forEach((slot,index)=>{
      if(index)sequence.append(el('span','arrow','→'));
      const box=el('div','order-slot');box.id=slot.id;box.tabIndex=-1;targets.set(slot.id,box);box.append(el('span','slot-label',slot.fixed?'固定':slot.label||`位置 ${index+1}`));
      if(slot.fixed)box.append(el('span','fixed-slot',slot.paragraphId));
      else {const select=el('select');select.dataset.part=slot.id;select.setAttribute('aria-label',`${slot.label||'位置 '+(index+1)} 选择段落`);select.append(new Option('—',''));
        for(const p of data.paragraphs.filter(p=>!fixed.includes(p.id))){const option=new Option(p.id,p.id);option.disabled=Object.entries(values).some(([id,value])=>id!==slot.id&&value===p.id);select.append(option);}
        select.value=values[slot.id]||'';select.disabled=submitted()||history();box.append(select);
        if(submitted()){const correct=slot.paragraphId===values[slot.id];box.classList.toggle('correct',correct);box.classList.toggle('incorrect',!!values[slot.id]&&!correct);box.append(el('span','slot-label',values[slot.id]?`答案 ${slot.paragraphId}`:'未答'));}
      }sequence.append(box);
    });parent.append(sequence);
  }
  function subjective(parent){
    if(EXAM_KIND==='translation')for(const part of publicData().parts){const section=el('section','part');section.id=part.id;section.tabIndex=-1;targets.set(part.id,section);const heading=el('h2','part-heading');heading.append(el('span','part-number',part.label+'.'),document.createTextNode(part.stem));section.append(heading);const input=el('textarea','translation-answer');input.dataset.part=part.id;input.value=values[part.id]||'';input.disabled=submitted()||history();input.setAttribute('aria-label',`第 ${part.label} 题译文`);section.append(input);parent.append(section);}
    else {parent.append(el('h2','section-title','你的答案'));const input=el('textarea','writing-answer');input.dataset.part='text';input.value=values.text||'';input.disabled=submitted()||history();input.setAttribute('aria-label','作文答案');parent.append(input);}
  }
  function result(parent){
    const data=demoData(), panel=el('section','result-area');const header=el('div','result-header');header.append(el('h2',null,'作答结果'));
    const score=demoSubmitted?demoScore:current.result?.score;
    header.append(el('span','score-readout',score==null?'待评分':`${score} / ${data.maxScore} 分${demoSubmitted?' · 演示':''}`));panel.append(header);
    if(EXAM_KIND==='translation')for(const part of data.parts||[]){if(part.referenceAnswer){panel.append(el('h3','reference-title',part.label+' · 参考译文'),el('p','reference',part.referenceAnswer));}}
    if(data.referenceAnswer)panel.append(el('h3','reference-title','参考答案'),el('p','reference',data.referenceAnswer));
    if(data.rubric)panel.append(el('h3','reference-title','评分说明'),el('p','reference',data.rubric));
    if(data.explanation)panel.append(el('h3','reference-title','解析'),el('p','reference',data.explanation));
    if(['translation','writing'].includes(EXAM_KIND)){
      const row=el('div','review-row');const slider=el('input');slider.type='range';slider.min=0;slider.max=data.maxScore;slider.step=.5;slider.value=score??0;slider.id='review-slider';slider.setAttribute('aria-label','人工评分');slider.disabled=history()||!demoSubmitted;
      const output=el('output',null,`${score??0} 分`);output.id='review-output';output.htmlFor='review-slider';row.append(el('span',null,'人工评分'),slider,output);panel.append(row,el('p','notice',demoSubmitted?'初始 0 分待人工调整；当前评分仅为界面演示。':'以 0.5 分为单位调整。'));
      const ai=el('div','ai-row'),button=el('button',null,'AI 评分');button.type='button';button.id='ai-grade';button.disabled=history();ai.append(button,el('span','ai-status','尚未启用'));panel.append(ai);const message=el('p','ai-message');message.id='ai-message';message.setAttribute('role','status');message.hidden=true;panel.append(message);
    }parent.append(panel);
  }
  function render(){
    if(disposed||!current)return;disposeRenderers();root.replaceChildren();
    root.append(el('p','directions',publicData().directions));rich(root,publicData().stem);
    const area=el('div','answer-area');
    if(['cloze','reading'].includes(EXAM_KIND))for(const part of publicData().parts)area.append(choices(part,EXAM_KIND==='cloze'));
    else if(EXAM_KIND==='paragraph-order')order(area);else subjective(area);root.append(area);
    if(submitted())result(root);
    const footer=el('footer','footer'),notice=el('p','notice',history()?'历史只读':submitted()?'界面演示：结果没有写入练习记录。':'可部分作答后提交本组。');notice.setAttribute('role','status');footer.append(notice);
    if(!history()){const button=el('button','primary',submitted()?'重新作答':'提交本组');button.id=submitted()?'retry':'submit';button.type='button';footer.append(button);}root.append(footer);root.querySelectorAll('textarea').forEach(grow);QF.ui.resize();
  }
  function localSubmit(){
    demoSubmitted=true;const data=EXAM_DEMO_FIXTURES[current.question.id];demoScore=0;
    if(['cloze','reading'].includes(EXAM_KIND))demoScore=data.parts.reduce((sum,p)=>sum+(values[p.id]===p.correctOptionId?p.maxScore:0),0);
    else if(EXAM_KIND==='paragraph-order'){const blanks=data.sequence.filter(p=>!p.fixed);demoScore=blanks.reduce((sum,p)=>sum+(values[p.id]===p.paragraphId?data.maxScore/blanks.length:0),0);}
    render();document.dispatchEvent(new CustomEvent('exam-prototype-submit',{detail:{questionId:current.question.id}}));
  }
  function onInput(event){if(submitted()||history()||!event.target.dataset.part)return;values[event.target.dataset.part]=event.target.value;if(event.target.tagName==='TEXTAREA')grow(event.target);remember();}
  function onChange(event){if(submitted()||history()||!event.target.dataset.part)return;values[event.target.dataset.part]=event.target.value;remember();if(event.target.tagName==='SELECT')render();else if(event.target.type==='radio'){const group=event.target.closest('.choices');group.querySelectorAll('.choice').forEach(row=>row.classList.toggle('is-selected',row.querySelector('input').checked));}}
  async function onClick(event){const id=event.target.closest('button')?.id;if(history())return;
    if(id==='submit')localSubmit();
    if(id==='retry'){demoSubmitted=false;values={};demoScore=0;remember();render();}
    if(id==='ai-grade'){
      // UI prototype: the planned public endpoint is QF.ai.grade({force:false}).
      // Actual grade/getTask/retry Reply handling is implemented after UI approval.
      const message=root.querySelector('#ai-message');message.hidden=false;
      // Only the isolated standalone demo uses a rejecting mock of the public API.
      // Installed development pages do not call a configured model during UI review.
      const reply=window.EXAM_STANDALONE_DEMO?await QF.ai.grade({force:false}):{ok:false,error:{code:'DEVELOPMENT_NOT_IMPLEMENTED',message:'AI 评分暂未启用。本次仅演示按钮与反馈。'}};
      message.textContent=reply.ok?'AI 操作反馈仅供界面演示。':reply.error?.message||'AI 评分未完成。';QF.ui.resize();
    }
  }
  function onScore(event){if(event.target.id!=='review-slider')return;demoScore=Number(event.target.value);root.querySelector('#review-output').textContent=demoScore+' 分';root.querySelector('.score-readout').textContent=`${demoScore} / ${publicData().maxScore} 分 · 演示`;}
  root.addEventListener('input',onInput);root.addEventListener('input',onScore);root.addEventListener('change',onChange);root.addEventListener('click',onClick);
  QF.page.register({onLoad(context){if(current?.question.id!==context.question.id){values={...(context.answer?.values||{})};demoSubmitted=false;demoScore=0;}current=context;render();},async onOutlineNavigate(id){await Promise.all(renders.map(r=>r.ready));const target=targets.get(id);if(!target)return false;target.scrollIntoView({block:'center'});target.focus({preventScroll:true});return true;},onFlush(){},onDispose(){disposed=true;disposeRenderers();root.removeEventListener('input',onInput);root.removeEventListener('input',onScore);root.removeEventListener('change',onChange);root.removeEventListener('click',onClick);}}).catch(error=>{root.append(el('p','editor-alert',error.message));});
})();
