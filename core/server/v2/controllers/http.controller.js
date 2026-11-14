/** @typedef {import('../types/http.js').QuestionOperation} QuestionOperation */
/** @typedef {import('../types/http.js').QuestionHandlers} QuestionHandlers */
/** @typedef {import('../types/http.js').BankHandlers} BankHandlers */
/** @typedef {import('../types/http.js').ServerContext} ServerContext */
/** @typedef {import('../types/http.js').Handler} Handler */
/** @typedef {import('../types/http.js').Handlers} Handlers */
/** @typedef {import('../types/http.js').HttpResponse} HttpResponse */
/** @typedef {import('../types/http.js').SdkHandler} SdkHandler */
/** @typedef {import('../services/bank.service.js').LibrarySnapshots} LibrarySnapshots */
/** @typedef {import('../../../shared/v2/api.js').HealthResponse} HealthResponse */
/** @typedef {import('../../../shared/v2/api.js').ExtensionManifestResponse} ManifestResponse */
import path from 'node:path';
import { problem } from '../utils/errors.js';
import { sdkResource, uiFile } from '../services/resource.service.js';
import { json, rootPage } from '../utils/http-response.js';
import { measureSave, withOverviewTiming } from '../utils/timing.js';

/**
 * @param {HttpResponse} response
 */
const snapshotId = (response) => response.locals.target.searchParams.get('snapshotId');

/**
 * @param {LibrarySnapshots} library
 * @returns {QuestionHandlers}
 */
function questionWrites(library) {
  /**
   * @param {QuestionOperation} operation
   * @returns {Handler}
   */
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

/**
 * @param {ServerContext} server
 * @param {LibrarySnapshots} library
 * @returns {BankHandlers}
 */
function bankHandlers(server, library) {
  /**
   * @param {'finish' | 'results'} operation @returns {Handler}
   */
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

/**
 * @param {ServerContext} server
 * @param {LibrarySnapshots} library
 * @returns {Pick<Handlers, 'asset' | 'listening'>}
 */
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

/**
 * @param {ServerContext} server
 * @param {LibrarySnapshots} library
 * @returns {Pick<Handlers, 'manifest' | 'extensionFile' | 'unknownExtensionRoute'>}
 */
function extensionHandlers(server, library) {
  return {
    manifest(request, response) {
      const artifact = library.artifact(request.params.artifactId);
      if (!artifact.development) {
        server.immutable(response);
      }
      json(
        response,
        200,
        /** @satisfies {ManifestResponse} */ ({
          ...artifact.descriptor,
          name: artifact.manifest.name,
          entries: {
            practice: { html: 'practice-html', js: 'practice-js', css: 'practice-css' },
            grade: 'grade-js',
          },
          sdkVersions: artifact.sdkVersions,
        }),
      );
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

/**
 * @param {ServerContext} server
 * @param {LibrarySnapshots} library @returns {SdkHandler}
 */
function sdkHandler(server, library) {
  return (request, response) => {
    const { file, expectedHash } = sdkResource(library, request.params, snapshotId(response));
    server.binary(request, response, file, { executable: true, expectedHash });
  };
}

/**
 * @param {ServerContext} server @returns {Handlers}
 */
export function createHandlers(server) {
  const { library } = server;
  return {
    rootPage,
    health(_request, response) {
      json(
        response,
        200,
        /** @satisfies {HealthResponse} */ ({
          apiVersion: 2,
          phase: 'segment-1',
          availableFeatures: ['catalog', 'overview', 'question', 'resources', 'submit', 'result'],
        }),
      );
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
