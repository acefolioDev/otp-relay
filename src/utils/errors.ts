export class HttpError extends Error {
  constructor(public readonly statusCode: number, public readonly publicMessage: string) {
    super(publicMessage);
  }
}
export class StorageError extends Error {
  constructor() { super('Storage unavailable'); }
}
