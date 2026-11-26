// SQLite rows are untyped: callers narrow them where they read them.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const db: {
  prepare(sql: string): {
    get(...params: unknown[]): any;
    all(...params: unknown[]): any[];
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number | bigint };
  };
  exec(sql: string): void;
};
export function transaction<T>(action: () => T): T;
