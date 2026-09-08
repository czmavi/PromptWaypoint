export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export function requireValue<T>(
  value: T | undefined,
  message = "Not found",
): T {
  if (value === undefined) throw new ApiError(404, message);
  return value;
}
