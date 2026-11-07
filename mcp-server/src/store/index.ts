import { docsFileStore } from './file/docsStore';
import { fileAreaFileStore } from './file/fileAreaStore';
import { taskFileStore } from './file/taskStore';
import type { IndexStores } from './types';

let stores: IndexStores = { fileAreas: fileAreaFileStore, tasks: taskFileStore, docs: docsFileStore };

/** The index stores builders, searchers and index tools read and write through. */
export function indexStores(): IndexStores {
  return stores;
}

/** Replace the file stores, e.g. with the platform's Postgres store. */
export function setIndexStores(next: IndexStores): void {
  stores = next;
}
