declare module 'sql.js' {
  declare class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  declare class Statement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
    reset(): void;
  }

  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  interface SqlJsStatic {
    Database: typeof Database;
  }

  function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
  export default initSqlJs;
  export { Database, Statement };
  export type { QueryExecResult, SqlJsStatic };
}
