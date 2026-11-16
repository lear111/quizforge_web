import { createPracticeLibrary } from '../../server/v2/services/bank.service.js';
import { PracticeState } from '../../server/v2/services/practice.service.js';
import { archivePractice } from '../../server/v2/services/practice-archive.service.js';
const [root, codeRoot, bankId, phase] = process.argv.slice(2);
const library = createPracticeLibrary(root, codeRoot, { stateStore: new PracticeState() });
const overview = library.open(bankId);
archivePractice(library, library.opened.get(bankId), {
  requestId: 'crash-restart', snapshotId: overview.snapshotId,
}, at => { if (at === phase) process.exit(87); });
