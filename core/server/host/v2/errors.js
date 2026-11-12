export class V2Error extends Error {
  constructor(status, code, message, context = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.context = context;
  }
}
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function problem(code, message, context = {}, status = 422) { return new V2Error(status, code, message, context); }
export function publicError(error) {
  return error instanceof V2Error
    ? { code: error.code, message: error.message, ...error.context }
    : { code: 'STORAGE_UNAVAILABLE', message: '暂时无法读取本地文件，请检查文件和访问权限。' };
}
