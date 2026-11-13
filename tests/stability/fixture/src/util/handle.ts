// lowercase letters, digits and dashes, 3 to 30 characters
const HANDLE = /^[a-z0-9-]{3,30}$/;

export function isHandle(text: string): boolean {
  return HANDLE.test(text);
}
