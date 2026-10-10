const EXAM_KIND="translation";
const EXAM_DEMO_FIXTURES={"sample-translation-2026": {"directions": "Read the text carefully and translate the underlined segments into Chinese. (10 points)", "stem": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Science education today revolves around the idea of scientific literacy—the base-level knowledge about science that nonscientists require to effectively get on in the world. This concept has served as a central goal for curriculum developers, local school boards, business and community leaders, and policymakers ever since its introduction nearly 80 years ago."}]}, {"type": "paragraph", "content": [{"type": "text", "text": "(46) "}, {"type": "text", "text": "Tracing the history of the term, we can see how the definition of scientific literacy has shifted over time, muddying the waters when it comes to determining the goals of science education.", "marks": [{"type": "underline"}]}, {"type": "text", "text": " And that’s a shame, because there is much to recommend in the idea of scientific literacy as it was originally articulated in 1945, a time when science appeared to be the key to progress and scientists seemingly held the fate of the world in their hands. (47) "}, {"type": "text", "text": "A return to that version of scientific literacy, which focused more on teaching what science is and how it works and less on memorizing scientific facts, seems like something society today desperately needs.", "marks": [{"type": "underline"}]}]}, {"type": "paragraph", "content": [{"type": "text", "text": "In the United States, the desire to provide the public with a general, nontechnical education in science originated as far back as the late 1800s. (48) "}, {"type": "text", "text": "Educators advanced the idea of having students complete detailed laboratory exercises in high schools in the belief that such work was beneficial primarily as a way to enhance logical reasoning and observational skills.", "marks": [{"type": "underline"}]}, {"type": "text", "text": " The development in 1915 of the popular new subject “general science” was another effort to train students to apply the principles of science to everyday, nonscience problems."}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Although these efforts were aimed at the nonscience-bound student, they never really made their way into mainstream thought and public discourse as a means to rally widespread support for the importance of science teaching in schools. (49) "}, {"type": "text", "text": "It wasn’t until the phrase “scientific literacy” came along in the 1940s that science had the formidable slogan it needed to command public attention and make improving science education an important national goal.", "marks": [{"type": "underline"}]}]}, {"type": "paragraph", "content": [{"type": "text", "text": "(50) "}, {"type": "text", "text": "The intense focus on scientific literacy in the United States originally grew out of the critical role of science and technology during World War II, as well as the perceived deficiencies of American soldiers.", "marks": [{"type": "underline"}]}, {"type": "text", "text": " As the war unfolded, science rapidly assumed a central role. Battles increasingly depended on new military technologies such as radar and the proximity fuze. Science-based analytical approaches proved remarkably successful in the hunt for German submarines in the Atlantic Ocean. And there was the (then-secret) work building the world’s first atomic bomb. As a result, scientists—physicists in particular— found themselves in high demand."}]}]}, "parts": [{"id": "q46", "label": "46", "stem": "Tracing the history of the term, we can see how the definition of scientific literacy has shifted over time, muddying the waters when it comes to determining the goals of science education.", "referenceAnswer": "追溯这一术语的历史，我们可以看到科学素养的定义如何随时间推 移而演变，这使得在确定科学教育的目标时，情况变得模糊不清。", "explanation": "", "rubric": "", "maxScore": 2}, {"id": "q47", "label": "47", "stem": "A return to that version of scientific literacy, which focused more on teaching what science is and how it works and less on memorizing scientific facts, seems like something society today desperately needs.", "referenceAnswer": "回归到那个版本的科学素养理念——它更侧重于教授科学的本质与 运作方式，而非记忆科学事实——似乎正是当今社会所亟需的。", "explanation": "", "rubric": "", "maxScore": 2}, {"id": "q48", "label": "48", "stem": "Educators advanced the idea of having students complete detailed laboratory exercises in high schools in the belief that such work was beneficial primarily as a way to enhance logical reasoning and observational skills.", "referenceAnswer": "教育家们提出了让学生在高中阶段完成详细实验训练的主张，他们 认为这类训练的主要益处在于能提升逻辑推理和观察能力。", "explanation": "", "rubric": "", "maxScore": 2}, {"id": "q49", "label": "49", "stem": "It wasn’t until the phrase “scientific literacy” came along in the 1940s that science had the formidable slogan it needed to command public attention and make improving science education an important national goal.", "referenceAnswer": "直到 20 世纪 40 年代“科学素养”这一说法出现，科学才拥有了一 个极具号召力的口号，得以赢得公众关注，并将改善科学教育确立为一项重 要的国家目标。", "explanation": "", "rubric": "", "maxScore": 2}, {"id": "q50", "label": "50", "stem": "The intense focus on scientific literacy in the United States originally grew out of the critical role of science and technology during World War II, as well as the perceived deficiencies of American soldiers.", "referenceAnswer": "美国对科学素养的高度关注，最初源于科学技术在二战期间发挥的 关键作用，以及当时所意识到的美国士兵的素质不足。", "explanation": "", "rubric": "", "maxScore": 2}], "referenceAnswer": "", "rubric": "", "maxScore": 10}};
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
