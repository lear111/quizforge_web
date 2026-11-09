import fs from 'node:fs';
import path from 'node:path';
import {scanBanks,scanExtensions} from '../../server/host/library/directories.js';
import {FormatFiles,readManifests,UUID,losslessBytes} from '../../server/host/library/format4.js';

// Provision synthetic legacy fixtures for the current export contract. Never
// invoked on the developer's installed library or on production inputs.
export function makeFormat4Fixture(root) {
  if (!path.resolve(root).split(path.sep).includes('.temp')) throw new Error('Fixture root must be temporary');
  const extensions=scanExtensions(path.join(root,'extensions'));
  for(const directory of extensions) {
    const file=path.join(directory,'manifest.json'),m=JSON.parse(fs.readFileSync(file));
    if(!m.examples.startsWith('examples/')) {
      const source=path.join(directory,m.examples);m.examples='examples/bank.json';fs.mkdirSync(path.dirname(path.join(directory,m.examples)),{recursive:true});
      fs.copyFileSync(source,path.join(directory,m.examples));fs.writeFileSync(file,JSON.stringify(m));
    }
  }
  // Legacy extension fixtures store their example images in root assets.
  for(const directory of extensions) {
    const m=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))),assets=path.join(directory,'assets');
    if(fs.existsSync(assets)) fs.cpSync(assets,path.join(path.dirname(path.join(directory,m.examples)),'assets'),{recursive:true});
  }
  const banks=scanBanks(path.join(root,'question-banks')).banks,leaves=[...extensions,...banks.map(f=>path.dirname(f))];
  const files=new FormatFiles(root,leaves),relative=file=>path.relative(root,file).replaceAll('\\','/');
  const manifests=readManifests(files,extensions.map(relative));
  for(const [file,owner] of [...banks.map(f=>[f,null]),...extensions.map(d=>[path.join(d,manifests.get(relative(d)).examples),relative(d)])]) {
    const name=relative(file),before=files.document(name);
    if(before.formatVersion?.literal==='2') continue;
    const result=files.bank(name,manifests,{legacy:true,exampleOwner:owner});
    if(UUID.test(before.id??'')) result.raw.id=before.id;
    files.replacements.set(name,losslessBytes(result.raw));
  }
  files.apply();
}
