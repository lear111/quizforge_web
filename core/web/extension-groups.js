// Folders organize independent installed extensions. A group is never a
// runnable collection and carries no extension identity or combined samples.
export function extensionGroups(rows){
  const roots=[],groups=new Map();
  for(const row of rows){
    const parts=typeof row.group==='string'?row.group.replace(/\\/g,'/').split('/').filter(Boolean):[];
    let children=roots,path='';
    for(const name of parts){
      path=path?`${path}/${name}`:name;
      let group=groups.get(path);
      if(!group){group={kind:'group',name,path,children:[]};groups.set(path,group);children.push(group);}
      children=group.children;
    }
    children.push({kind:'extension',row});
  }
  return roots;
}
