export function consecutiveQuestionGroups(questions,defaultType={id:'question',name:'题目'}){
  defaultType ||= {id:'question',name:'题目'};
  const groups=[];
  for(const [index,question]of questions.entries()){
    const type=question.type||defaultType,id=type.id||defaultType.id,name=type.name||defaultType.name,version=type.version||'',developmentFolder=type.development?.folder||'',snapshotTypeId=type.typeId||'';
    let group=groups.at(-1);
    if(!group||group.typeId!==id||group.version!==version||group.developmentFolder!==developmentFolder||group.snapshotTypeId!==snapshotTypeId){group={typeId:id,version,name,developmentFolder,snapshotTypeId,items:[]};groups.push(group);}
    group.items.push({question,number:index+1});
  }
  return groups;
}
