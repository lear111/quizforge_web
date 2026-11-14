import path from 'node:path';
import { problem } from '../utils/errors.js';
import { sdkResource, uiFile } from '../services/resource.service.js';
import { json, rootPage } from '../utils/http-response.js';
import { measureSave, withOverviewTiming } from '../utils/timing.js';

const snapshotId = (response) => response.locals.target.searchParams.get('snapshotId');

function questionWrites(library) {
  const write = (operation) => (request, response) => {
    const { bankId, questionId } = request.params;
    const value = measureSave('validate', () =>
      library.write(bankId, questionId, operation, response.locals.input),
    );
    json(response, 200, value);
  };
  return {
    answer: write('answer'),
    ink: write('ink'),
    result: write('result'),
    retry: write('retry'),
    submit: write('submit'),
  };
}

function bankHandlers(server, library) {
  const roundWrite = (operation) => (request, response) => {
    const value = measureSave('validate', () =>
      library[operation](request.params.bankId, response.locals.input),
    );
    json(response, 200, value);
  };
  return {
    overview(request, response) {
      const questionId = response.locals.target.searchParams.get('questionId') ?? undefined;
      withOverviewTiming(server.timings && request.method === 'GET', () =>
        json(response, 200, library.open(request.params.bankId, questionId)),
      );
    },
    question(request, response) {
      const { bankId, questionId } = request.params;
      json(response, 200, library.question(bankId, questionId, snapshotId(response)));
    },
    refresh(request, response) {
      json(response, 200, library.refresh(request.params.bankId, response.locals.input));
    },
    finish: roundWrite('finish'),
    results: roundWrite('results'),
    ...questionWrites(library),
  };
}

function bankResources(server, library) {
  return {
    asset(request, response) {
      const { bankId, questionId, assetId } = request.params;
      const { file, expectedHash } = library.asset(
        bankId,
        questionId,
        snapshotId(response),
        assetId,
      );
      server.binary(request, response, file, { expectedHash });
    },
    listening(request, response) {
      const { bankId, materialId } = request.params;
      const material = library.listening(bankId, materialId, snapshotId(response));
      if (material.file) {
        server.binary(request, response, material.file);
      } else {
        json(response, 200, material);
      }
    },
  };
}

function extensionHandlers(server, library) {
  return {
    manifest(request, response) {
      const artifact = library.artifact(request.params.artifactId);
      if (!artifact.development) {
        server.immutable(response);
      }
      json(response, 200, {
        ...artifact.descriptor,
        name: artifact.manifest.name,
        entries: {
          practice: { html: 'practice-html', js: 'practice-js', css: 'practice-css' },
          grade: 'grade-js',
        },
        sdkVersions: artifact.sdkVersions,
      });
    },
    extensionFile(request, response) {
      const { artifactId, entryId } = request.params;
      const artifact = library.artifact(artifactId);
      const file = artifact.files.get(entryId);
      if (!file) {
        throw problem('RESOURCE_NOT_FOUND', '拓展入口不存在。', {}, 404);
      }
      const expectedHash = artifact.development
        ? undefined
        : artifact.hashes.get(path.relative(artifact.directory, file).replaceAll('\\', '/'));
      server.binary(request, response, file, { executable: true, expectedHash });
    },
    unknownExtensionRoute(request, _response, next) {
      // Missing artifacts won over the generic unknown-read error in the old dispatcher.
      library.artifact(request.params.artifactId);
      next();
    },
  };
}

function sdkHandler(server, library) {
  return (request, response) => {
    const { file, expectedHash } = sdkResource(library, request.params, snapshotId(response));
    server.binary(request, response, file, { executable: true, expectedHash });
  };
}

export function createHandlers(server) {
  const { library } = server;
  return {
    rootPage,
    health(_request, response) {
      json(response, 200, {
        apiVersion: 2,
        phase: 'segment-1',
        availableFeatures: ['catalog', 'overview', 'question', 'resources', 'submit', 'result'],
      });
    },
    catalog(_request, response) {
      json(response, 200, library.catalog());
    },
    ui(request, response) {
      const file = uiFile(server.codeRoot, response.locals.parts[1]);
      server.binary(request, response, file);
    },
    ...bankHandlers(server, library),
    ...bankResources(server, library),
    ...extensionHandlers(server, library),
    sdk: sdkHandler(server, library),
  };
}
