export class ShopError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ShopError';
    this.code = code;
  }
}
