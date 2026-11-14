import { API, EXTENSION } from './paths.js';

export function registerExtensionRoutes(app, handlers) {
  app.get(`${EXTENSION}/manifest`, handlers.manifest);
  app.get(`${EXTENSION}/files/:entryId`, handlers.extensionFile);
  app.get(`${EXTENSION}/*rest`, handlers.unknownExtensionRoute);
  app.get(`${API}/sdk/:component/:version/*entry`, handlers.sdk);
}
