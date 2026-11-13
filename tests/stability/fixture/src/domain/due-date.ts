export function dueDate(): Date {
  const today = new Date();
  return new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
}
